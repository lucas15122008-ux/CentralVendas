import {owner,database,errorResponse} from '@/lib/server';
import type {CostRecord,Sale} from '@/lib/finance';
import {applyReconciliation,reconciliationEventsFromRows,type ReconciliationEventRow} from '@/lib/reconciliation';

export async function GET(){try{
 const id=await owner();const db=database();const results=await db.batch([
  db.prepare('SELECT id,name,created_at AS createdAt FROM accounts WHERE owner_id=? ORDER BY created_at').bind(id),
  db.prepare('SELECT id,account_id AS accountId,filename,valid_from AS validFrom,row_count AS rowCount,created_at AS createdAt,withdrawn_at AS withdrawnAt,config FROM imports WHERE owner_id=? ORDER BY created_at DESC').bind(id),
  db.prepare('SELECT c.id,c.account_id AS accountId,c.import_id AS importId,c.sku,c.description,c.unit_cost AS unitCost,c.tax_value AS taxValue,c.tax_type AS taxType,c.tax_treatment AS taxTreatment,c.valid_from AS validFrom,c.imported_at AS importedAt FROM cost_versions c JOIN imports i ON i.id=c.import_id WHERE c.owner_id=? AND i.owner_id=? AND i.withdrawn_at IS NULL ORDER BY c.valid_from DESC,c.imported_at DESC,c.id DESC').bind(id,id),
  db.prepare('SELECT m.data FROM meli_orders m JOIN accounts a ON a.id=m.account_id AND a.owner_id=m.owner_id WHERE m.owner_id=? ORDER BY m.date DESC,m.order_id DESC').bind(id),
  db.prepare("SELECT r.account_id AS accountId,a.name,r.status FROM meli_sync_runs r JOIN meli_connections c ON c.account_id=r.account_id AND c.owner_id=r.owner_id JOIN accounts a ON a.id=r.account_id AND a.owner_id=r.owner_id WHERE r.owner_id=? AND (r.status<>'complete' OR r.needs_more=1)").bind(id),
  db.prepare('SELECT id,account_id AS accountId,target_type AS targetType,target_key AS targetKey,valid_from AS validFrom,revision,action,payload,source_stamp AS sourceStamp,reason,created_at AS createdAt FROM reconciliation_events WHERE owner_id=? ORDER BY created_at,revision').bind(id),
 ]);
 const costs=results[2].results as unknown as CostRecord[];
 const rawSales=results[3].results.flatMap(row=>{try{return JSON.parse(String((row as {data:string}).data)) as Sale[]}catch{return []}});
 const reconciliationEvents=reconciliationEventsFromRows(results[5].results as unknown as ReconciliationEventRow[]);
 return Response.json({accounts:results[0].results,imports:results[1].results,costs,syncWarnings:results[4].results,reconciliationEvents,sales:applyReconciliation(rawSales,costs,reconciliationEvents)},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return errorResponse(error)}
}
