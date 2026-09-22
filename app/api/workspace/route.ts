import {owner,database,digest,errorResponse} from '@/lib/server';
import type {CostRecord,Sale} from '@/lib/finance';
import {reconciliationEventsFromRows,type ReconciliationEventRow} from '@/lib/reconciliation';
import {fullMonthSource,previewFullMonth} from '@/lib/full-reconciliation';
import {fullClosuresFromRows,type FullAllocationRow,type FullClosureRow} from '@/lib/full-closure-store';
import {adProfileEventFromRow,type AdProfileRow} from '@/lib/ad-profile-store';
import {latestAdProfile} from '@/lib/ad-profiles';
import {saleCorrectionEventFromRow,type SaleCorrectionRow} from '@/lib/sale-correction-store';
import type {MeliListing} from '@/lib/meli/catalog';
import {projectSales} from '@/lib/sale-projection';
import {collectPending} from '@/lib/pending';
import {getAdProfileMigrationStatus,migrationRolloutState,type MigrationIssue,type MigrationRolloutState} from '@/lib/ad-profile-migration';

type ListingRow=Omit<MeliListing,'variationId'|'hasProfile'>&{variationId:string};
type RolloutRow={state:string;sourceStamp:string;report:string;activatedAt:string|null;updatedAt:string};
const migrationCodes=new Set<MigrationIssue['code']>(['missing_cost','unknown_tax','ambiguous_cost','projection_difference']);

function issuesFromReport(row:RolloutRow|null):MigrationIssue[]{
 if(row?.state!=='blocked')return [];
 try{
  const value=JSON.parse(row.report) as {issues?:unknown[]};
  if(!Array.isArray(value.issues))return [];
  return value.issues.filter((issue):issue is MigrationIssue=>{
   if(!issue||typeof issue!=='object')return false;
   const item=issue as Partial<MigrationIssue>;
   return typeof item.accountId==='string'&&typeof item.itemId==='string'&&(item.variationId===null||typeof item.variationId==='string')&&typeof item.code==='string'&&migrationCodes.has(item.code as MigrationIssue['code'])&&typeof item.message==='string';
  });
 }catch{return [];}
}

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
  db.prepare('SELECT id,account_id AS accountId,item_id AS itemId,variation_id AS variationId,valid_from AS validFrom,revision,action,payload,request_id AS requestId,reason,origin,created_at AS createdAt FROM ad_profile_events WHERE owner_id=? ORDER BY created_at,revision').bind(id),
  db.prepare('SELECT id,account_id AS accountId,sale_id AS saleId,field,revision,action,mode,value,source_value AS sourceValue,source_stamp AS sourceStamp,request_id AS requestId,reason,created_at AS createdAt FROM sale_correction_events WHERE owner_id=? ORDER BY created_at,revision').bind(id),
  db.prepare('SELECT id,account_id AS accountId,item_id AS itemId,variation_id AS variationId,title,status,seller_sku AS sellerSku,updated_at AS updatedAt FROM meli_listings WHERE owner_id=? ORDER BY account_id,title,item_id,variation_id').bind(id),
  db.prepare('SELECT state,source_stamp AS sourceStamp,report,activated_at AS activatedAt,updated_at AS updatedAt FROM ad_profile_rollouts WHERE owner_id=?').bind(id),
 ]);
 const costs=results[2].results as unknown as CostRecord[];
 const rawSales=results[3].results.flatMap(row=>{try{return JSON.parse(String((row as {data:string}).data)) as Sale[]}catch{return []}});
 const reconciliationEvents=reconciliationEventsFromRows(results[5].results as unknown as ReconciliationEventRow[]);
 const closures=fullClosuresFromRows(results[6].results as unknown as FullClosureRow[],results[7].results as unknown as FullAllocationRow[]);
 const adProfiles=(results[8].results as unknown as AdProfileRow[]).map(adProfileEventFromRow).filter((event):event is NonNullable<typeof event>=>event!==null);
 const saleCorrections=(results[9].results as unknown as SaleCorrectionRow[]).map(saleCorrectionEventFromRow).filter((event):event is NonNullable<typeof event>=>event!==null);
 const listings=(results[10].results as unknown as ListingRow[]).map(row=>{
  const variationId=row.variationId===''?null:row.variationId;
  return {...row,variationId,hasProfile:!!latestAdProfile(adProfiles,row.accountId,row.itemId,variationId)};
 });
 const rolloutRow=(results[11].results[0]??null) as RolloutRow|null;
 let rolloutState:MigrationRolloutState=migrationRolloutState(rolloutRow?.state,costs.length>0||reconciliationEvents.length>0);
 let rolloutSourceStamp=rolloutRow?.sourceStamp??null,migrationIssues=issuesFromReport(rolloutRow);
 if(rolloutState==='blocked'){
  const current=await getAdProfileMigrationStatus(db,id);rolloutState=current.state;rolloutSourceStamp=current.sourceStamp;
  migrationIssues=current.state==='blocked'?current.issues:[];
 }
 const projectionInput={rawSales,legacyCosts:costs,reconciliationEvents,profiles:adProfiles,corrections:saleCorrections,closures:[],rolloutState};
 const base=projectSales(projectionInput);
 const latest=new Map<string,(typeof closures)[number]>();
 for(const closure of closures){const key=closure.accountId+'\0'+closure.month;const saved=latest.get(key);if(!saved||closure.revision>saved.revision)latest.set(key,closure);}
 await Promise.all([...latest.values()].map(async closure=>{
  if(closure.action!=='set')return;
  const source=await digest(fullMonthSource(previewFullMonth(base.sales,base.calculationCosts,closure.accountId,closure.month),base.calculationCosts));
  if(source!==closure.sourceStamp)closure.stale=true;
 }));
 const projection=projectSales({...projectionInput,closures});
 const pending=collectPending({sales:projection.results,listings,migrationIssues});
 const fullClosures=[...latest.values()].sort((a,b)=>b.month.localeCompare(a.month)||a.accountId.localeCompare(b.accountId)).map(({allocations,...closure})=>({...closure,allocationCount:allocations.length}));
 const rollout={state:rolloutState,sourceStamp:rolloutSourceStamp,activatedAt:rolloutRow?.activatedAt??null,updatedAt:rolloutRow?.updatedAt??null};
 return Response.json({accounts:results[0].results,imports:results[1].results,costs,syncWarnings:results[4].results,reconciliationEvents,fullClosures,sales:projection.sales,listings,adProfiles,saleCorrections,pending,rollout},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return errorResponse(error)}
}
