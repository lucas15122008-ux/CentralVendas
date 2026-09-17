import {z} from 'zod';
import {owner,database,errorResponse,HttpError} from '@/lib/server';
import {calculateSale,type CostRecord,type ReconciliationAmounts,type Sale} from '@/lib/finance';
import {applyReconciliation,productTargetKey,reconciliationEventFromRow,reconciliationEventsFromRows,type ReconciliationEventRow} from '@/lib/reconciliation';

const requestId=z.string().uuid();
const accountId=z.string().uuid();
const reason=z.string().trim().min(3).max(240);
const revision=z.number().int().min(0).max(1_000_000);
const validDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);
const cents=z.number().int().min(0).max(1_000_000_000_000).nullable();
const amounts=z.object({revenueCents:cents,feeCents:cents,shippingCents:cents,otherCents:cents,costCents:cents,taxCents:cents,fullExpenseCents:cents});
const productBase={kind:z.literal('product'),requestId,accountId,itemId:z.string().trim().min(1).max(80),variationId:z.string().trim().max(80).nullable().optional(),validFrom:validDate,expectedRevision:revision,reason};
const saleBase={kind:z.literal('sale'),requestId,accountId,saleId:z.string().trim().min(1).max(200),expectedRevision:revision,reason};
const inputSchema=z.union([
 z.object({...productBase,action:z.literal('set'),sku:z.string().trim().min(1).max(120)}),
 z.object({...productBase,action:z.literal('clear')}),
 z.object({...saleBase,action:z.literal('set'),sourceStamp:z.string().min(2).max(12_000),channel:z.enum(['full','other','unknown']),amounts}),
 z.object({...saleBase,action:z.literal('clear')}),
]);

const eventSelect='id,account_id AS accountId,target_type AS targetType,target_key AS targetKey,valid_from AS validFrom,revision,action,payload,source_stamp AS sourceStamp,reason,created_at AS createdAt';
async function accountExists(db:D1Database,user:string,id:string){return !!await db.prepare('SELECT id FROM accounts WHERE id=? AND owner_id=?').bind(id,user).first();}
async function accountSales(db:D1Database,user:string,id:string){
 const rows=await db.prepare('SELECT id,data,updated_at AS updatedAt FROM meli_orders WHERE owner_id=? AND account_id=? ORDER BY date DESC,order_id DESC').bind(user,id).all<{id:string;data:string;updatedAt:number}>();
 return rows.results.flatMap(row=>{try{return (JSON.parse(row.data) as Sale[]).map(sale=>({sale,rowId:row.id,rowData:row.data,updatedAt:row.updatedAt}))}catch{return []}});
}
async function accountCosts(db:D1Database,user:string,id:string){
 const rows=await db.prepare('SELECT c.id,c.account_id AS accountId,c.import_id AS importId,c.sku,c.description,c.unit_cost AS unitCost,c.tax_value AS taxValue,c.tax_type AS taxType,c.tax_treatment AS taxTreatment,c.valid_from AS validFrom,c.imported_at AS importedAt FROM cost_versions c JOIN imports i ON i.id=c.import_id WHERE c.owner_id=? AND c.account_id=? AND i.owner_id=? AND i.withdrawn_at IS NULL ORDER BY c.valid_from DESC,c.imported_at DESC,c.id DESC').bind(user,id,user).all<CostRecord>();
 return rows.results;
}
async function accountEvents(db:D1Database,user:string,id:string){
 const rows=await db.prepare(`SELECT ${eventSelect} FROM reconciliation_events WHERE owner_id=? AND account_id=? ORDER BY created_at,revision`).bind(user,id).all<ReconciliationEventRow>();
 return reconciliationEventsFromRows(rows.results);
}

export async function POST(request:Request){try{
 const user=await owner(request);let body:unknown;try{body=await request.json()}catch{throw new HttpError(400,'Dados de conciliação inválidos.');}
 const parsed=inputSchema.safeParse(body);if(!parsed.success)throw new HttpError(400,'Revise os valores, a vigência e o motivo da conciliação.');
 const input=parsed.data;const db=database();
 const existing=await db.prepare(`SELECT ${eventSelect} FROM reconciliation_events WHERE owner_id=? AND request_id=?`).bind(user,input.requestId).first<ReconciliationEventRow>();
 if(existing){const event=reconciliationEventFromRow(existing);return Response.json({event,duplicate:true});}
 if(!await accountExists(db,user,input.accountId))throw new HttpError(404,'Conta não encontrada.');
 const saleSources=await accountSales(db,user,input.accountId);const sales=saleSources.map(source=>source.sale);
 let targetType:'product'|'sale';let targetKey:string;let validFrom='';let payload:string|null=null;let sourceStamp:string|null=null;let sourceGuard='';let sourceGuardValues:(string|number)[]=[];
 if(input.kind==='product'){
  const variation=input.variationId??null;const found=sales.some(sale=>sale.itemId===input.itemId&&(sale.variationId??null)===variation);if(!found)throw new HttpError(404,'Anúncio ou variação não encontrado nesta conta.');
  targetType='product';targetKey=productTargetKey(input.itemId,variation);validFrom=input.validFrom;
  if(input.action==='set'){
   const cost=await db.prepare('SELECT c.id FROM cost_versions c JOIN imports i ON i.id=c.import_id WHERE c.owner_id=? AND c.account_id=? AND c.sku=? AND i.owner_id=? AND i.withdrawn_at IS NULL LIMIT 1').bind(user,input.accountId,input.sku,user).first();
   if(!cost)throw new HttpError(404,'SKU não encontrado nos custos ativos desta conta.');
   payload=JSON.stringify({kind:'product',sku:input.sku});
  }
 }else{
  const source=saleSources.find(item=>item.sale.id===input.saleId);if(!source)throw new HttpError(404,'Venda não encontrada nesta conta.');const sale=source.sale;
  targetType='sale';targetKey=input.saleId;
  if(input.action==='set'){
   const costs=await accountCosts(db,user,input.accountId);const events=await accountEvents(db,user,input.accountId);const current=applyReconciliation([sale],costs,events)[0];
   if(current.sourceStamp!==input.sourceStamp)throw new HttpError(409,'A venda ou o custo mudou. Recarregue os dados antes de salvar.');
   const cost=calculateSale({...current,reconciliation:undefined},costs).cost;const costSku=current.costSku??current.sku;
   sourceGuard=" AND EXISTS(SELECT 1 FROM meli_orders WHERE id=? AND owner_id=? AND account_id=? AND updated_at=? AND data=?) AND COALESCE((SELECT c.id FROM cost_versions c JOIN imports i ON i.id=c.import_id WHERE c.owner_id=? AND c.account_id=? AND c.sku=? AND c.valid_from<=? AND i.owner_id=? AND i.withdrawn_at IS NULL ORDER BY c.valid_from DESC,c.imported_at DESC,c.id DESC LIMIT 1),'')=?";
   sourceGuardValues=[source.rowId,user,input.accountId,source.updatedAt,source.rowData,user,input.accountId,costSku,current.date,user,cost?.id??''];
   if(current.itemId){
    const productKey=productTargetKey(current.itemId,current.variationId);const link=events.find(event=>event.accountId===current.accountId&&event.targetType==='product'&&event.targetKey===productKey&&event.validFrom===current.linkValidFrom&&event.revision===current.linkRevision);
    sourceGuard+=" AND COALESCE((SELECT e.id FROM reconciliation_events e WHERE e.owner_id=? AND e.account_id=? AND e.target_type='product' AND e.target_key=? AND e.valid_from<=? AND e.revision=(SELECT MAX(e2.revision) FROM reconciliation_events e2 WHERE e2.owner_id=e.owner_id AND e2.account_id=e.account_id AND e2.target_type=e.target_type AND e2.target_key=e.target_key AND e2.valid_from=e.valid_from) AND e.action='set' ORDER BY e.valid_from DESC,e.revision DESC LIMIT 1),'')=?";
    sourceGuardValues.push(user,input.accountId,productKey,current.date,link?.id??'');
   }
   sourceStamp=input.sourceStamp;payload=JSON.stringify({kind:'sale',channel:input.channel,amounts:input.amounts satisfies ReconciliationAmounts});
  }
 }
 const eventId=crypto.randomUUID();const createdAt=new Date().toISOString();const nextRevision=input.expectedRevision+1;
 const result=await db.prepare(`INSERT INTO reconciliation_events(id,owner_id,account_id,target_type,target_key,valid_from,revision,request_id,action,payload,source_stamp,reason,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ?=(SELECT COALESCE(MAX(revision),0) FROM reconciliation_events WHERE owner_id=? AND account_id=? AND target_type=? AND target_key=? AND valid_from=?)${sourceGuard}`)
  .bind(eventId,user,input.accountId,targetType,targetKey,validFrom,nextRevision,input.requestId,input.action,payload,sourceStamp,input.reason,createdAt,input.expectedRevision,user,input.accountId,targetType,targetKey,validFrom,...sourceGuardValues).run();
 if(!result.meta.changes){
  const replay=await db.prepare(`SELECT ${eventSelect} FROM reconciliation_events WHERE owner_id=? AND request_id=?`).bind(user,input.requestId).first<ReconciliationEventRow>();
  if(replay)return Response.json({event:reconciliationEventFromRow(replay),duplicate:true});
  throw new HttpError(409,'Esta conciliação foi alterada em outra aba. Recarregue antes de salvar novamente.');
 }
 const saved=await db.prepare(`SELECT ${eventSelect} FROM reconciliation_events WHERE id=? AND owner_id=?`).bind(eventId,user).first<ReconciliationEventRow>();
 return Response.json({event:saved&&reconciliationEventFromRow(saved)},{status:201});
 }catch(error){return errorResponse(error)}
}
