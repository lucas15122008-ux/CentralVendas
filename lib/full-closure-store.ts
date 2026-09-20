import {allocateFullMonth,fullMonthSource,previewFullMonth,type FullClosure} from './full-reconciliation.ts';
import type {CostRecord,Sale} from './finance.ts';
import {digest,HttpError} from './server.ts';

export type FullClosureCommand={action:'set'|'clear';requestId:string;accountId:string;month:string;expectedRevision:number;totalExpenseCents?:number;reason:string};
export type FullClosureProjection={sales:Sale[];costs:CostRecord[]};
type ClosureRow={id:string;accountId:string;month:string;revision:number;action:string;totalExpenseCents:number|null;eligibleUnits:number;sourceStamp:string|null;reason:string;createdAt:string};
type AllocationRow={closureId:string;saleId:string;units:number;expenseCents:number};
const eventSelect='id,account_id AS accountId,month,revision,action,total_expense_cents AS totalExpenseCents,eligible_units AS eligibleUnits,source_stamp AS sourceStamp,reason,created_at AS createdAt';

function closuresFromRows(events:ClosureRow[],allocations:AllocationRow[]):FullClosure[]{
 const byClosure=new Map<string,FullClosure['allocations']>();
 for(const row of allocations){
  const current=byClosure.get(row.closureId)??[];
  current.push({saleId:row.saleId,units:row.units,expenseCents:row.expenseCents});
  byClosure.set(row.closureId,current);
 }
 return events.filter((row):row is ClosureRow&{action:'set'|'clear'}=>row.action==='set'||row.action==='clear').map(row=>({...row,allocations:(byClosure.get(row.id)??[]).sort((a,b)=>a.saleId.localeCompare(b.saleId))}));
}

export async function loadFullClosures(db:D1Database,owner:string,accountId?:string):Promise<FullClosure[]>{
 const where=accountId?'owner_id=? AND account_id=?':'owner_id=?';
 const values=accountId?[owner,accountId]:[owner];
 const events=await db.prepare(`SELECT ${eventSelect} FROM full_closure_events WHERE ${where} ORDER BY month,revision`).bind(...values).all<ClosureRow>();
 if(!events.results.length)return [];
 const allocations=await db.prepare(`SELECT closure_id AS closureId,sale_id AS saleId,units,expense_cents AS expenseCents FROM full_closure_allocations WHERE ${where} ORDER BY closure_id,sale_id`).bind(...values).all<AllocationRow>();
 return closuresFromRows(events.results,allocations.results);
}

async function replay(db:D1Database,owner:string,requestId:string):Promise<FullClosure|null>{
 const event=await db.prepare(`SELECT ${eventSelect} FROM full_closure_events WHERE owner_id=? AND request_id=?`).bind(owner,requestId).first<ClosureRow>();
 if(!event||(event.action!=='set'&&event.action!=='clear'))return null;
 const allocations=await db.prepare('SELECT closure_id AS closureId,sale_id AS saleId,units,expense_cents AS expenseCents FROM full_closure_allocations WHERE owner_id=? AND closure_id=? ORDER BY sale_id').bind(owner,event.id).all<AllocationRow>();
 return closuresFromRows([event],allocations.results)[0]??null;
}

export async function saveFullClosure(db:D1Database,owner:string,command:FullClosureCommand,projection:FullClosureProjection):Promise<{closure:FullClosure;duplicate:boolean}>{
 const existing=await replay(db,owner,command.requestId);
 if(existing)return {closure:existing,duplicate:true};
 const preview=previewFullMonth(projection.sales,projection.costs,command.accountId,command.month);
 if(command.action==='set'&&preview.conflicts.length)throw new HttpError(409,preview.conflicts[0]+' Remova o valor individual antes de fechar o mês.');
 const totalExpenseCents=command.action==='set'?command.totalExpenseCents??null:null;
 if(command.action==='set'&&totalExpenseCents===null)throw new HttpError(400,'Informe o total do demonstrativo Full.');
 let allocations:FullClosure['allocations']=[];
 try{allocations=command.action==='set'?allocateFullMonth(totalExpenseCents!,preview):[];}
 catch(error){throw new HttpError(409,error instanceof Error?error.message:'Não foi possível ratear a despesa Full.');}
 const sourceStamp=command.action==='set'?await digest(fullMonthSource(preview,projection.costs)):null;
 const eligibleUnits=command.action==='set'?preview.units:0;
 const id=crypto.randomUUID(),createdAt=new Date().toISOString(),revision=command.expectedRevision+1;
 const header=db.prepare(`INSERT INTO full_closure_events(id,owner_id,account_id,month,revision,request_id,action,total_expense_cents,eligible_units,source_stamp,reason,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ?=(SELECT COALESCE(MAX(revision),0) FROM full_closure_events WHERE owner_id=? AND account_id=? AND month=?) RETURNING ${eventSelect}`).bind(id,owner,command.accountId,command.month,revision,command.requestId,command.action,totalExpenseCents,eligibleUnits,sourceStamp,command.reason,createdAt,command.expectedRevision,owner,command.accountId,command.month);
 const statements=[header,...allocations.map(row=>db.prepare('INSERT INTO full_closure_allocations(closure_id,owner_id,account_id,sale_id,units,expense_cents) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM full_closure_events WHERE id=? AND owner_id=? AND account_id=?)').bind(id,owner,command.accountId,row.saleId,row.units,row.expenseCents,id,owner,command.accountId))];
 let results:D1Result<unknown>[];
 try{results=await db.batch(statements);}
 catch(error){
  const duplicate=await replay(db,owner,command.requestId);
  if(duplicate)return {closure:duplicate,duplicate:true};
  throw error;
 }
 if(!results[0]?.results.length){
  const duplicate=await replay(db,owner,command.requestId);
  if(duplicate)return {closure:duplicate,duplicate:true};
  throw new HttpError(409,'Este fechamento foi alterado em outra aba. Recarregue antes de salvar novamente.');
 }
 return {closure:{id,accountId:command.accountId,month:command.month,revision,action:command.action,totalExpenseCents,eligibleUnits,sourceStamp,reason:command.reason,createdAt,allocations},duplicate:false};
}
