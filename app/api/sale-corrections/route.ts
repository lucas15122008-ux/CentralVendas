import {z} from 'zod';
import type {CostRecord,Sale} from '@/lib/finance';
import {applyReconciliation,reconciliationEventsFromRows,type ReconciliationEventRow} from '@/lib/reconciliation';
import {saveSaleCorrection} from '@/lib/sale-correction-store';
import {database,errorResponse,HttpError,owner} from '@/lib/server';

const requestId=z.string().uuid();
const accountId=z.string().uuid();
const field=z.enum(['revenueCents','feeCents','shippingCents','otherCents','costQuantity']);
const revision=z.number().int().min(0).max(1_000_000);
const reason=z.string().trim().min(3).max(240);
const amount=z.number().int().min(0).max(1_000_000_000_000).nullable();
const base={requestId,accountId,saleId:z.string().trim().min(1).max(200),field,expectedRevision:revision,sourceStamp:z.string().min(2).max(12_000),reason};
const inputSchema=z.union([
 z.object({...base,action:z.literal('set'),mode:z.enum(['fallback','override']),value:amount.refine(value=>value!==null),sourceValue:amount}),
 z.object({...base,action:z.literal('clear'),mode:z.enum(['fallback','override']).default('fallback'),sourceValue:amount.default(null)}),
]);

async function currentSale(db:D1Database,user:string,account:string,saleId:string){
 const accountRow=await db.prepare('SELECT id FROM accounts WHERE id=? AND owner_id=?').bind(account,user).first();
 if(!accountRow)throw new HttpError(404,'Conta não encontrada.');
 const rows=await db.prepare('SELECT data FROM meli_orders WHERE owner_id=? AND account_id=? ORDER BY date DESC,order_id DESC').bind(user,account).all<{data:string}>();
 let raw:Sale|undefined;
 for(const row of rows.results){
  try{raw=(JSON.parse(row.data) as Sale[]).find(sale=>sale.id===saleId);if(raw)break;}catch{}
 }
 if(!raw)throw new HttpError(404,'Venda não encontrada nesta conta.');
 const [costRows,eventRows]=await Promise.all([
  db.prepare('SELECT c.id,c.account_id AS accountId,c.import_id AS importId,c.sku,c.description,c.unit_cost AS unitCost,c.tax_value AS taxValue,c.tax_type AS taxType,c.tax_treatment AS taxTreatment,c.valid_from AS validFrom,c.imported_at AS importedAt FROM cost_versions c JOIN imports i ON i.id=c.import_id WHERE c.owner_id=? AND c.account_id=? AND i.owner_id=? AND i.withdrawn_at IS NULL ORDER BY c.valid_from DESC,c.imported_at DESC,c.id DESC').bind(user,account,user).all<CostRecord>(),
  db.prepare('SELECT id,account_id AS accountId,target_type AS targetType,target_key AS targetKey,valid_from AS validFrom,revision,action,payload,source_stamp AS sourceStamp,reason,created_at AS createdAt FROM reconciliation_events WHERE owner_id=? AND account_id=? ORDER BY created_at,revision').bind(user,account).all<ReconciliationEventRow>(),
 ]);
 return applyReconciliation([raw],costRows.results,reconciliationEventsFromRows(eventRows.results))[0];
}

export async function POST(request:Request){try{
 const user=await owner(request);
 let body:unknown;try{body=await request.json();}catch{throw new HttpError(400,'Dados da correção inválidos.');}
 const parsed=inputSchema.safeParse(body);
 if(!parsed.success)throw new HttpError(400,'Revise o campo, o valor, a fonte e o motivo.');
 const input=parsed.data,db=database(),sale=await currentSale(db,user,input.accountId,input.saleId);
 const saved=await saveSaleCorrection(db,user,{
  action:input.action,requestId:input.requestId,accountId:input.accountId,saleId:input.saleId,
  field:input.field,expectedRevision:input.expectedRevision,mode:input.mode,
  value:input.action==='set'?input.value:null,sourceValue:input.sourceValue,
  sourceStamp:input.sourceStamp,reason:input.reason,
 },sale);
 return Response.json(saved,{status:saved.duplicate?200:201});
 }catch(error){return errorResponse(error);}
}
