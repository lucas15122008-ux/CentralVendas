import type {Sale} from './finance.ts';
import type {CorrectableField,SaleCorrectionEvent} from './sale-corrections.ts';
import {HttpError} from './server.ts';

export type SaleCorrectionCommand={
 action:'set'|'clear';
 requestId:string;
 accountId:string;
 saleId:string;
 field:CorrectableField;
 expectedRevision:number;
 mode:'fallback'|'override';
 value:number|null;
 sourceValue:number|null;
 sourceStamp:string;
 reason:string;
};

type SaleCorrectionRow=Omit<SaleCorrectionEvent,'field'|'action'|'mode'> & {
 field:string;
 action:string;
 mode:string;
};

const eventSelect='id,account_id AS accountId,sale_id AS saleId,field,revision,action,mode,value,source_value AS sourceValue,source_stamp AS sourceStamp,request_id AS requestId,reason,created_at AS createdAt';
const correctableFields=new Set<CorrectableField>(['revenueCents','feeCents','shippingCents','otherCents','costQuantity']);

export function saleCorrectionEventFromRow(row:SaleCorrectionRow):SaleCorrectionEvent|null{
 if(!correctableFields.has(row.field as CorrectableField))return null;
 if(row.action!=='set'&&row.action!=='clear')return null;
 if(row.mode!=='fallback'&&row.mode!=='override')return null;
 return {...row,field:row.field as CorrectableField,action:row.action,mode:row.mode};
}

async function replay(db:D1Database,ownerId:string,requestId:string){
 const row=await db.prepare(`SELECT ${eventSelect} FROM sale_correction_events WHERE owner_id=? AND request_id=?`)
  .bind(ownerId,requestId).first<SaleCorrectionRow>();
 return row?saleCorrectionEventFromRow(row):null;
}

export async function loadSaleCorrections(db:D1Database,ownerId:string):Promise<SaleCorrectionEvent[]>{
 const rows=await db.prepare(`SELECT ${eventSelect} FROM sale_correction_events WHERE owner_id=? ORDER BY created_at,revision`)
  .bind(ownerId).all<SaleCorrectionRow>();
 return rows.results.map(saleCorrectionEventFromRow).filter((event):event is SaleCorrectionEvent=>event!==null);
}

export async function saveSaleCorrection(db:D1Database,ownerId:string,command:SaleCorrectionCommand,currentSale:Sale):Promise<{event:SaleCorrectionEvent;duplicate:boolean}>{
 const existing=await replay(db,ownerId,command.requestId);
 if(existing)return {event:existing,duplicate:true};
 if(currentSale.accountId!==command.accountId||currentSale.id!==command.saleId)throw new HttpError(404,'Venda não encontrada nesta conta.');
 if(currentSale.sourceStamp!==command.sourceStamp)throw new HttpError(409,'Os dados oficiais da venda mudaram. Recarregue antes de salvar.');
 const currentValue=currentSale[command.field];
 if(command.action==='set'){
  if(command.value===null)throw new HttpError(400,'Informe o valor da correção.');
  if(command.mode==='fallback'&&currentValue!==null)throw new HttpError(409,'O Mercado Livre já informou este campo. Use uma correção explícita.');
  if(command.mode==='override'&&(currentValue===null||currentValue!==command.sourceValue))throw new HttpError(409,'O valor oficial mudou. Recarregue antes de salvar.');
 }
 const id=crypto.randomUUID(),revision=command.expectedRevision+1,createdAt=new Date().toISOString();
 const value=command.action==='set'?command.value:null;
 const statement=db.prepare(`INSERT INTO sale_correction_events(id,owner_id,account_id,sale_id,field,revision,request_id,action,mode,value,source_value,source_stamp,reason,created_at)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?
 WHERE ?=(SELECT COALESCE(MAX(revision),0) FROM sale_correction_events WHERE owner_id=? AND account_id=? AND sale_id=? AND field=?)`)
  .bind(id,ownerId,command.accountId,command.saleId,command.field,revision,command.requestId,command.action,command.mode,value,command.sourceValue,command.sourceStamp,command.reason,createdAt,command.expectedRevision,ownerId,command.accountId,command.saleId,command.field);
 try{
  const result=await statement.run();
  if(!result.meta.changes){
   const duplicate=await replay(db,ownerId,command.requestId);
   if(duplicate)return {event:duplicate,duplicate:true};
   throw new HttpError(409,'Esta correção foi alterada em outra aba. Recarregue antes de salvar novamente.');
  }
 }catch(error){
  if(error instanceof HttpError)throw error;
  const duplicate=await replay(db,ownerId,command.requestId);
  if(duplicate)return {event:duplicate,duplicate:true};
  throw error;
 }
 return {event:{id,accountId:command.accountId,saleId:command.saleId,field:command.field,revision,action:command.action,mode:command.mode,value,sourceValue:command.sourceValue,sourceStamp:command.sourceStamp,requestId:command.requestId,reason:command.reason,createdAt},duplicate:false};
}
