import type {AdProfileEvent,AdProfilePayload} from './ad-profiles.ts';
import {HttpError} from './server.ts';

export type AdProfileCommand={
 action:'set'|'clear';
 requestId:string;
 accountId:string;
 itemId:string;
 variationId:string|null;
 validFrom:string;
 expectedRevision:number;
 payload:AdProfilePayload|null;
 reason:string;
 origin:'native'|'legacy';
};

type AdProfileRow=Omit<AdProfileEvent,'variationId'|'payload'|'action'|'origin'> & {
 variationId:string;
 payload:string|null;
 action:string;
 origin:string;
};

const eventSelect='id,account_id AS accountId,item_id AS itemId,variation_id AS variationId,valid_from AS validFrom,revision,action,payload,request_id AS requestId,reason,origin,created_at AS createdAt';

function canonicalPayload(payload:AdProfilePayload|null){
 if(!payload)return null;
 const tax=payload.tax.mode==='included'
  ?{mode:'included' as const}
  :payload.tax.mode==='unit'
   ?{mode:'unit' as const,valueTenThousandths:payload.tax.valueTenThousandths}
   :{mode:'percent' as const,rateBasisPoints:payload.tax.rateBasisPoints};
 return JSON.stringify({unitCostTenThousandths:payload.unitCostTenThousandths,tax,operation:payload.operation});
}

export function adProfileEventFromRow(row:AdProfileRow):AdProfileEvent|null{
 try{
  if(row.action!=='set'&&row.action!=='clear')return null;
  if(row.origin!=='native'&&row.origin!=='legacy')return null;
  const payload=row.payload===null?null:JSON.parse(row.payload) as AdProfilePayload;
  if(row.action==='set'&&!payload)return null;
  return {
   ...row,
   variationId:row.variationId===''?null:row.variationId,
   action:row.action,
   origin:row.origin,
   payload,
  };
 }catch{return null;}
}

async function replay(db:D1Database,ownerId:string,requestId:string){
 const row=await db.prepare(`SELECT ${eventSelect} FROM ad_profile_events WHERE owner_id=? AND request_id=?`)
  .bind(ownerId,requestId).first<AdProfileRow>();
 return row?adProfileEventFromRow(row):null;
}

export async function loadAdProfiles(db:D1Database,ownerId:string):Promise<AdProfileEvent[]>{
 const rows=await db.prepare(`SELECT ${eventSelect} FROM ad_profile_events WHERE owner_id=? ORDER BY created_at,revision`)
  .bind(ownerId).all<AdProfileRow>();
 return rows.results.map(adProfileEventFromRow).filter((event):event is AdProfileEvent=>event!==null);
}

export async function saveAdProfile(db:D1Database,ownerId:string,command:AdProfileCommand):Promise<{event:AdProfileEvent;duplicate:boolean}>{
 const existing=await replay(db,ownerId,command.requestId);
 if(existing)return {event:existing,duplicate:true};
 const variationId=command.variationId??'';
 const id=crypto.randomUUID();
 const revision=command.expectedRevision+1;
 const createdAt=new Date().toISOString();
 const payload=command.action==='set'?canonicalPayload(command.payload):null;
 const statement=db.prepare(`INSERT INTO ad_profile_events(id,owner_id,account_id,item_id,variation_id,valid_from,revision,request_id,action,payload,origin,reason,created_at)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
 WHERE ?=(SELECT COALESCE(MAX(revision),0) FROM ad_profile_events WHERE owner_id=? AND account_id=? AND item_id=? AND variation_id=? AND valid_from=?)`)
  .bind(id,ownerId,command.accountId,command.itemId,variationId,command.validFrom,revision,command.requestId,command.action,payload,command.origin,command.reason,createdAt,command.expectedRevision,ownerId,command.accountId,command.itemId,variationId,command.validFrom);
 try{
  const result=await statement.run();
  if(!result.meta.changes){
   const duplicate=await replay(db,ownerId,command.requestId);
   if(duplicate)return {event:duplicate,duplicate:true};
   throw new HttpError(409,'Esta ficha foi alterada em outra aba. Recarregue antes de salvar novamente.');
  }
 }catch(error){
  if(error instanceof HttpError)throw error;
  const duplicate=await replay(db,ownerId,command.requestId);
  if(duplicate)return {event:duplicate,duplicate:true};
  throw error;
 }
 const event:AdProfileEvent={
  id,accountId:command.accountId,itemId:command.itemId,variationId:command.variationId,
  validFrom:command.validFrom,revision,action:command.action,payload:command.action==='set'?command.payload:null,
  requestId:command.requestId,reason:command.reason,origin:command.origin,createdAt,
 };
 return {event,duplicate:false};
}
