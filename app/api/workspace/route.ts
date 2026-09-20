import {owner,database,digest,errorResponse} from '@/lib/server';
import type {CostRecord,Sale} from '@/lib/finance';
import {applyReconciliation,reconciliationEventsFromRows,type ReconciliationEventRow} from '@/lib/reconciliation';
import {applyFullClosures,fullMonthSource,previewFullMonth} from '@/lib/full-reconciliation';
import {fullClosuresFromRows,type FullAllocationRow,type FullClosureRow} from '@/lib/full-closure-store';

export async function GET(){try{
 const id=await owner();const db=database();const results=await db.batch([
  db.prepare('SELECT id,name,created_at AS createdAt FROM accounts WHERE owner_id=? ORDER BY created_at').bind(id),
  db.prepare('SELECT id,account_id AS accountId,filename,valid_from AS validFrom,row_count AS rowCount,created_at AS createdAt,withdrawn_at AS withdrawnAt,config FROM imports WHERE owner_id=? ORDER BY created_at DESC').bind(id),
  db.prepare('SELECT c.id,c.account_id AS accountId,c.import_id AS importId,c.sku,c.description,c.unit_cost AS unitCost,c.tax_value AS taxValue,c.tax_type AS taxType,c.tax_treatment AS taxTreatment,c.valid_from AS validFrom,c.imported_at AS importedAt FROM cost_versions c JOIN imports i ON i.id=c.import_id WHERE c.owner_id=? AND i.owner_id=? AND i.withdrawn_at IS NULL ORDER BY c.valid_from DESC,c.imported_at DESC,c.id DESC').bind(id,id),
  db.prepare('SELECT m.data FROM meli_orders m JOIN accounts a ON a.id=m.account_id AND a.owner_id=m.owner_id WHERE m.owner_id=? ORDER BY m.date DESC,m.order_id DESC').bind(id),
  db.prepare("SELECT r.account_id AS accountId,a.name,r.status FROM meli_sync_runs r JOIN meli_connections c ON c.account_id=r.account_id AND c.owner_id=r.owner_id JOIN accounts a ON a.id=r.account_id AND a.owner_id=r.owner_id WHERE r.owner_id=? AND (r.status<>'complete' OR r.needs_more=1)").bind(id),
  db.prepare('SELECT id,account_id AS accountId,target_type AS targetType,target_key AS targetKey,valid_from AS validFrom,revision,action,payload,source_stamp AS sourceStamp,reason,created_at AS createdAt FROM reconciliation_events WHERE owner_id=? ORDER BY created_at,revision').bind(id),
  db.prepare('SELECT id,account_id AS accountId,month,revision,action,total_expense_cents AS totalExpenseCents,eligible_units AS eligibleUnits,source_stamp AS sourceStamp,reason,created_at AS createdAt FROM full_closure_events WHERE owner_id=? ORDER BY month,revision').bind(id),
  db.prepare('SELECT closure_id AS closureId,sale_id AS saleId,units,expense_cents AS expenseCents FROM full_closure_allocations WHERE owner_id=? ORDER BY closure_id,sale_id').bind(id),
 ]);
 const costs=results[2].results as unknown as CostRecord[];
 const rawSales=results[3].results.flatMap(row=>{try{return JSON.parse(String((row as {data:string}).data)) as Sale[]}catch{return []}});
 const reconciliationEvents=reconciliationEventsFromRows(results[5].results as unknown as ReconciliationEventRow[]);
 const reconciled=applyReconciliation(rawSales,costs,reconciliationEvents);
 const closures=fullClosuresFromRows(results[6].results as unknown as FullClosureRow[],results[7].results as unknown as FullAllocationRow[]);
 const latest=new Map<string,(typeof closures)[number]>();
 for(const closure of closures){const key=closure.accountId+'\0'+closure.month;const saved=latest.get(key);if(!saved||closure.revision>saved.revision)latest.set(key,closure);}
 await Promise.all([...latest.values()].map(async closure=>{
  if(closure.action!=='set')return;
  const source=await digest(fullMonthSource(previewFullMonth(reconciled,costs,closure.accountId,closure.month),costs));
  if(source!==closure.sourceStamp)closure.stale=true;
 }));
 const sales=applyFullClosures(reconciled,closures);
 const fullClosures=[...latest.values()].sort((a,b)=>b.month.localeCompare(a.month)||a.accountId.localeCompare(b.accountId)).map(({allocations,...closure})=>({...closure,allocationCount:allocations.length}));
 return Response.json({accounts:results[0].results,imports:results[1].results,costs,syncWarnings:results[4].results,reconciliationEvents,fullClosures,sales},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return errorResponse(error)}
}
