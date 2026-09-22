import {z} from 'zod';
import {database,digest,errorResponse,HttpError,owner} from '@/lib/server';
import type {CostRecord,Sale} from '@/lib/finance';
import {loadFullClosures,saveFullClosure} from '@/lib/full-closure-store';
import {applyFullClosures,fullMonthSource,previewFullMonth} from '@/lib/full-reconciliation';
import {reconciliationEventsFromRows,type ReconciliationEventRow} from '@/lib/reconciliation';
import {adProfileEventFromRow,type AdProfileRow} from '@/lib/ad-profile-store';
import {saleCorrectionEventFromRow,type SaleCorrectionRow} from '@/lib/sale-correction-store';
import {projectSales} from '@/lib/sale-projection';

const accountId=z.string().uuid();
const month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const requestId=z.string().uuid();
const reason=z.string().trim().min(3).max(240);
const expectedRevision=z.number().int().min(0).max(1_000_000);
const totalExpenseCents=z.number().int().min(0).max(1_000_000_000_000);
const commandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('set'),requestId,accountId,month,expectedRevision,totalExpenseCents,reason}).strict(),
 z.object({action:z.literal('clear'),requestId,accountId,month,expectedRevision,reason}).strict(),
]);

async function accountProjection(db:D1Database,user:string,id:string){
 const results=await db.batch([
  db.prepare('SELECT id FROM accounts WHERE id=? AND owner_id=?').bind(id,user),
  db.prepare('SELECT data FROM meli_orders WHERE owner_id=? AND account_id=? ORDER BY date,order_id').bind(user,id),
  db.prepare('SELECT c.id,c.account_id AS accountId,c.import_id AS importId,c.sku,c.description,c.unit_cost AS unitCost,c.tax_value AS taxValue,c.tax_type AS taxType,c.tax_treatment AS taxTreatment,c.valid_from AS validFrom,c.imported_at AS importedAt FROM cost_versions c JOIN imports i ON i.id=c.import_id WHERE c.owner_id=? AND c.account_id=? AND i.owner_id=? AND i.withdrawn_at IS NULL ORDER BY c.valid_from DESC,c.imported_at DESC,c.id DESC').bind(user,id,user),
  db.prepare('SELECT id,account_id AS accountId,target_type AS targetType,target_key AS targetKey,valid_from AS validFrom,revision,action,payload,source_stamp AS sourceStamp,reason,created_at AS createdAt FROM reconciliation_events WHERE owner_id=? AND account_id=? ORDER BY created_at,revision').bind(user,id),
  db.prepare('SELECT id,account_id AS accountId,item_id AS itemId,variation_id AS variationId,valid_from AS validFrom,revision,action,payload,request_id AS requestId,reason,origin,created_at AS createdAt FROM ad_profile_events WHERE owner_id=? AND account_id=? ORDER BY created_at,revision').bind(user,id),
  db.prepare('SELECT id,account_id AS accountId,sale_id AS saleId,field,revision,action,mode,value,source_value AS sourceValue,source_stamp AS sourceStamp,request_id AS requestId,reason,created_at AS createdAt FROM sale_correction_events WHERE owner_id=? AND account_id=? ORDER BY created_at,revision').bind(user,id),
  db.prepare('SELECT state FROM ad_profile_rollouts WHERE owner_id=?').bind(user),
 ]);
 if(!results[0].results.length)throw new HttpError(404,'Conta não encontrada.');
 const rawSales=results[1].results.flatMap(row=>{try{return JSON.parse(String((row as {data:string}).data)) as Sale[]}catch{return []}});
 const costs=results[2].results as unknown as CostRecord[];
 const events=reconciliationEventsFromRows(results[3].results as unknown as ReconciliationEventRow[]);
 const profiles=(results[4].results as unknown as AdProfileRow[]).map(adProfileEventFromRow).filter((event):event is NonNullable<typeof event>=>event!==null);
 const corrections=(results[5].results as unknown as SaleCorrectionRow[]).map(saleCorrectionEventFromRow).filter((event):event is NonNullable<typeof event>=>event!==null);
 const state=String((results[6].results[0] as {state?:string}|undefined)?.state);
 const projection=projectSales({rawSales,legacyCosts:costs,reconciliationEvents:events,profiles,corrections,closures:[],rolloutState:state==='active'?'active':state==='blocked'?'blocked':'pending'});
 return {sales:projection.sales,costs:projection.calculationCosts};
}

export async function GET(request:Request){try{
 const user=await owner();
 const url=new URL(request.url);const parsed=z.object({accountId,month}).safeParse({accountId:url.searchParams.get('accountId'),month:url.searchParams.get('month')});
 if(!parsed.success)throw new HttpError(400,'Informe a conta e o mês no formato AAAA-MM.');
 const db=database();const projection=await accountProjection(db,user,parsed.data.accountId);
 const preview=previewFullMonth(projection.sales,projection.costs,parsed.data.accountId,parsed.data.month);
 const currentSource=await digest(fullMonthSource(preview,projection.costs));
 const all=await loadFullClosures(db,user,parsed.data.accountId);
 const history=all.filter(row=>row.month===parsed.data.month).map(row=>({...row,...(row.action==='set'&&row.sourceStamp!==currentSource?{stale:true}:{})}));
 const latest=[...history].sort((a,b)=>b.revision-a.revision)[0]??null;
 const latestByMonth=new Map<string,(typeof all)[number]>();
 for(const row of all){const saved=latestByMonth.get(row.month);if(!saved||row.revision>saved.revision)latestByMonth.set(row.month,row);}
 const candidates=[...latestByMonth.values()].filter(row=>row.month<parsed.data.month&&row.action==='set'&&row.totalExpenseCents!==null&&row.eligibleUnits>0).sort((a,b)=>b.month.localeCompare(a.month));
 let previous:(typeof candidates)[number]|undefined;
 for(const candidate of candidates){
  const source=await digest(fullMonthSource(previewFullMonth(projection.sales,projection.costs,parsed.data.accountId,candidate.month),projection.costs));
  if(candidate.sourceStamp===source){previous=candidate;break;}
 }
 const previousUnitRateCents=previous?Math.round(previous.totalExpenseCents!/previous.eligibleUnits):null;
 const estimatedExpenseCents=latest?.action==='set'?null:previous?applyFullClosures(projection.sales,[previous]).filter(sale=>sale.accountId===parsed.data.accountId&&sale.date.slice(0,7)===parsed.data.month&&sale.fullExpense?.state==='estimated').reduce((sum,sale)=>sum+sale.fullExpense!.cents,0):null;
 return Response.json({accountId:parsed.data.accountId,month:parsed.data.month,preview,latest,history,previousUnitRateCents,estimatedExpenseCents},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return errorResponse(error)}
}

export async function POST(request:Request){try{
 const user=await owner(request);let body:unknown;try{body=await request.json()}catch{throw new HttpError(400,'Dados do fechamento Full inválidos.');}
 const parsed=commandSchema.safeParse(body);if(!parsed.success)throw new HttpError(400,'Revise o mês, o valor, a revisão e o motivo do fechamento.');
 const db=database();const projection=await accountProjection(db,user,parsed.data.accountId);
 const saved=await saveFullClosure(db,user,parsed.data,projection);
 return Response.json({event:saved.closure,duplicate:saved.duplicate},{status:saved.duplicate?200:201});
 }catch(error){return errorResponse(error)}
}
