import {activeAdProfile,latestAdProfile,type AdProfileEvent,type AdProfilePayload,type OperationOverride,type TaxRule} from './ad-profiles.ts';
import {applyFullClosures,type FullClosure} from './full-reconciliation.ts';
import {calculateSale,type CostRecord,type Sale,type SaleResult} from './finance.ts';
import {activeProductLink,applyReconciliation,reconciliationEventsFromRows,type ReconciliationEvent,type ReconciliationEventRow} from './reconciliation.ts';
import {applyAdProfiles} from './sale-projection.ts';

export type LegacyImport={id:string;accountId:string;withdrawnAt:string|null};
export type LegacyWorkspace={
 ownerId:string;
 imports:LegacyImport[];
 costs:CostRecord[];
 sales:Sale[];
 reconciliationEvents:ReconciliationEvent[];
 fullClosures:FullClosure[];
 nativeProfiles?:AdProfileEvent[];
};
export type MigrationIssue={
 accountId:string;itemId:string;variationId:string|null;
 code:'missing_cost'|'unknown_tax'|'ambiguous_cost'|'projection_difference';
 message:string;
};
export type MigrationPlan={sourceStamp:string;profiles:AdProfileEvent[];issues:MigrationIssue[];comparedSales:number;blockingDifferences:number};
export type MigrationRolloutState='pending'|'blocked'|'active';
export type MigrationStatus=MigrationPlan&{state:MigrationRolloutState;persistedProfileCount:number};

type Target={accountId:string;itemId:string;variationId:string|null;sales:Sale[]};

function targetKey(accountId:string,itemId:string,variationId:string|null){return JSON.stringify([accountId,itemId,variationId]);}
function stableHash(value:string){
 const seeds=[0x811c9dc5,0x9e3779b9,0x85ebca6b,0xc2b2ae35];
 return seeds.map(seed=>{
  let hash=seed>>>0;
  for(let index=0;index<value.length;index++){
   hash^=value.charCodeAt(index);
   hash=Math.imul(hash,0x01000193)>>>0;
   hash=(hash^(hash>>>13))>>>0;
  }
  return hash.toString(16).padStart(8,'0');
 }).join('');
}
function canonicalSource(input:LegacyWorkspace){
 const imports=input.imports.map(row=>({id:row.id,accountId:row.accountId,withdrawnAt:row.withdrawnAt})).sort((a,b)=>a.id.localeCompare(b.id));
 const costs=input.costs.map(row=>({id:row.id,accountId:row.accountId,importId:row.importId,sku:row.sku,unitCost:row.unitCost,taxValue:row.taxValue,taxType:row.taxType,taxTreatment:row.taxTreatment,validFrom:row.validFrom,importedAt:row.importedAt})).sort((a,b)=>a.id.localeCompare(b.id));
 const sales=input.sales.map(row=>({id:row.id,accountId:row.accountId,itemId:row.itemId??null,variationId:row.variationId??null,sku:row.sku,date:row.date,quantity:row.quantity,costQuantity:row.costQuantity,revenueCents:row.revenueCents,feeCents:row.feeCents,shippingCents:row.shippingCents,otherCents:row.otherCents,status:row.status,logisticType:row.logisticType??null,sourceIssues:row.sourceIssues??[]})).sort((a,b)=>a.id.localeCompare(b.id));
 const reconciliationEvents=input.reconciliationEvents.map(row=>({id:row.id,accountId:row.accountId,targetType:row.targetType,targetKey:row.targetKey,validFrom:row.validFrom,revision:row.revision,action:row.action,payload:row.payload,sourceStamp:row.sourceStamp,createdAt:row.createdAt})).sort((a,b)=>a.id.localeCompare(b.id));
 const fullClosures=input.fullClosures.map(row=>({id:row.id,accountId:row.accountId,month:row.month,revision:row.revision,action:row.action,totalExpenseCents:row.totalExpenseCents,eligibleUnits:row.eligibleUnits,sourceStamp:row.sourceStamp,stale:row.stale??false,allocations:[...row.allocations].sort((a,b)=>a.saleId.localeCompare(b.saleId))})).sort((a,b)=>a.id.localeCompare(b.id));
 const nativeProfiles=(input.nativeProfiles??[]).map(row=>({id:row.id,accountId:row.accountId,itemId:row.itemId,variationId:row.variationId,validFrom:row.validFrom,revision:row.revision,action:row.action,payload:row.payload,requestId:row.requestId,reason:row.reason,createdAt:row.createdAt})).sort((a,b)=>a.id.localeCompare(b.id));
 return JSON.stringify({ownerId:input.ownerId,imports,costs,sales,reconciliationEvents,fullClosures,nativeProfiles});
}
function sourceStamp(input:LegacyWorkspace){return `migration-v1:${stableHash(canonicalSource(input))}`;}

function parseProductTarget(event:ReconciliationEvent):{itemId:string;variationId:string|null}|null{
 if(event.targetType!=='product')return null;
 try{
  const value=JSON.parse(event.targetKey) as unknown;
  if(!Array.isArray(value)||value.length!==2||typeof value[0]!=='string'||!(value[1]===null||typeof value[1]==='string'))return null;
  return {itemId:value[0],variationId:value[1]};
 }catch{return null;}
}
function compareCost(a:CostRecord,b:CostRecord){return b.validFrom.localeCompare(a.validFrom)||b.importedAt.localeCompare(a.importedAt)||b.id.localeCompare(a.id);}
function selectedCost(costs:CostRecord[],accountId:string,sku:string,date:string){
 return costs.filter(row=>row.accountId===accountId&&row.sku===sku&&row.validFrom<=date).sort(compareCost)[0]??null;
}
function taxRule(cost:CostRecord):TaxRule|null{
 if(cost.taxTreatment==='included')return {mode:'included'};
 if(cost.taxTreatment==='unknown'||cost.taxValue===null)return null;
 if(cost.taxType==='unit')return {mode:'unit',valueTenThousandths:Math.round(cost.taxValue*10_000)};
 return {mode:'percent',rateBasisPoints:Math.round(cost.taxValue*100)};
}
function operationOverride(channel:string|undefined):OperationOverride{return channel==='full'?'full':channel==='other'?'other':'auto';}
function samePayload(left:AdProfilePayload|null,right:AdProfilePayload|null){return JSON.stringify(left)===JSON.stringify(right);}
function costPayload(cost:CostRecord){return JSON.stringify({unitCost:cost.unitCost,taxValue:cost.taxValue,taxType:cost.taxType,taxTreatment:cost.taxTreatment});}

function collectTargets(input:LegacyWorkspace){
 const targets=new Map<string,Target>();
 for(const sale of input.sales){
  if(!sale.itemId)continue;
  const variationId=sale.variationId??null,key=targetKey(sale.accountId,sale.itemId,variationId);
  const target=targets.get(key)??{accountId:sale.accountId,itemId:sale.itemId,variationId,sales:[]};
  target.sales.push(sale);targets.set(key,target);
 }
 for(const event of input.reconciliationEvents){
  const parsed=parseProductTarget(event);if(!parsed)continue;
  const key=targetKey(event.accountId,parsed.itemId,parsed.variationId);
  if(!targets.has(key))targets.set(key,{accountId:event.accountId,itemId:parsed.itemId,variationId:parsed.variationId,sales:[]});
 }
 return [...targets.values()].sort((a,b)=>a.accountId.localeCompare(b.accountId)||a.itemId.localeCompare(b.itemId)||(a.variationId??'').localeCompare(b.variationId??''));
}

function addIssue(issues:MigrationIssue[],issue:MigrationIssue){
 if(!issues.some(saved=>saved.accountId===issue.accountId&&saved.itemId===issue.itemId&&saved.variationId===issue.variationId&&saved.code===issue.code&&saved.message===issue.message))issues.push(issue);
}

function targetProfiles(input:LegacyWorkspace,target:Target,costs:CostRecord[],stamp:string,issues:MigrationIssue[]):AdProfileEvent[]{
 const dummy=(date:string):Sale=>({
  id:'migration',orderId:'migration',accountId:target.accountId,sku:'',title:'',itemId:target.itemId,variationId:target.variationId,
  date,quantity:1,costQuantity:1,revenueCents:0,feeCents:0,shippingCents:0,otherCents:0,status:'paid',
 });
 const targetEvents=input.reconciliationEvents.filter(event=>{
  const parsed=parseProductTarget(event);
  return event.accountId===target.accountId&&parsed?.itemId===target.itemId&&parsed.variationId===target.variationId;
 });
 const linkedSkus=[...new Set(targetEvents.flatMap(event=>event.action==='set'&&event.payload?.kind==='product'?[event.payload.sku]:[]))];
 const hasLink=linkedSkus.length>0;
 const saleSkus=[...new Set(target.sales.map(row=>row.sku.trim()).filter(Boolean))];
 if(!hasLink&&saleSkus.length>1){
  addIssue(issues,{accountId:target.accountId,itemId:target.itemId,variationId:target.variationId,code:'ambiguous_cost',message:`O anúncio possui mais de um SKU histórico (${saleSkus.join(', ')}) e não tem vínculo explícito.`});
  return [];
 }
 const inferredSku=!hasLink&&saleSkus.length===1?saleSkus[0]:null;
 const relevantSkus=hasLink?linkedSkus:inferredSku?[inferredSku]:[];
 if(!relevantSkus.length){
  addIssue(issues,{accountId:target.accountId,itemId:target.itemId,variationId:target.variationId,code:'missing_cost',message:'O anúncio não possui SKU exato ou vínculo de custo.'});
  return [];
 }
 const dates=new Set<string>();
 if(hasLink)for(const event of targetEvents)if(event.action==='set'&&event.payload?.kind==='product')dates.add(event.validFrom);
 for(const row of costs)if(row.accountId===target.accountId&&relevantSkus.includes(row.sku))dates.add(row.validFrom);
 const profiles:AdProfileEvent[]=[];
 let previousPayload:AdProfilePayload|null=null;
 for(const validFrom of [...dates].sort()){
  const activeLink=hasLink?activeProductLink(input.reconciliationEvents,dummy(validFrom)):undefined;
  const sku=activeLink?.payload?.kind==='product'?activeLink.payload.sku:hasLink?null:inferredSku;
  if(!sku){previousPayload=null;continue;}
  const selected=selectedCost(costs,target.accountId,sku,validFrom);
  if(!selected){
   addIssue(issues,{accountId:target.accountId,itemId:target.itemId,variationId:target.variationId,code:'missing_cost',message:`Não há custo vigente para o SKU ${sku} em ${validFrom}.`});
   previousPayload=null;
   continue;
  }
  const concurrent=costs.filter(row=>row.accountId===target.accountId&&row.sku===sku&&row.validFrom===selected.validFrom);
  if(new Set(concurrent.map(costPayload)).size>1){
   addIssue(issues,{accountId:target.accountId,itemId:target.itemId,variationId:target.variationId,code:'ambiguous_cost',message:`O SKU ${sku} possui custos diferentes com a mesma vigência em ${selected.validFrom}. Revise a ficha do anúncio.`});
  }
  const tax=taxRule(selected);
  if(!tax){
   addIssue(issues,{accountId:target.accountId,itemId:target.itemId,variationId:target.variationId,code:'unknown_tax',message:`O imposto do SKU ${sku} não está definido em ${validFrom}.`});
   previousPayload=null;
   continue;
  }
  const payload:AdProfilePayload={unitCostTenThousandths:Math.round(selected.unitCost*10_000),tax,operation:operationOverride(activeLink?.payload?.kind==='product'?activeLink.payload.channel:undefined)};
  if(samePayload(previousPayload,payload))continue;
  const identity=`${input.ownerId}\0${target.accountId}\0${target.itemId}\0${target.variationId??''}\0${validFrom}\0${JSON.stringify(payload)}\0${stamp}`;
  const fingerprint=stableHash(identity);
  profiles.push({id:`legacy-${fingerprint}`,accountId:target.accountId,itemId:target.itemId,variationId:target.variationId,validFrom,revision:1,action:'set',payload,requestId:`legacy-${fingerprint}`,reason:'Migrado da conciliação e da planilha de custos',origin:'legacy',createdAt:`${validFrom}T00:00:00.000Z`});
  previousPayload=payload;
 }
 if(!profiles.length&&!issues.some(issue=>issue.accountId===target.accountId&&issue.itemId===target.itemId&&issue.variationId===target.variationId)){
  addIssue(issues,{accountId:target.accountId,itemId:target.itemId,variationId:target.variationId,code:'missing_cost',message:`Não há custo ativo para o SKU ${relevantSkus.join(', ')}.`});
 }
 return profiles;
}

function projectionValues(result:SaleResult){return {
 costCents:result.costCents,taxCents:result.taxCents,
 operation:{channel:result.operation?.channel??'unknown',source:result.operation?.source??'unknown'},
 contributionCents:result.contributionCents,resultState:result.resultState,
};}

export function buildAdProfileMigration(input:LegacyWorkspace):MigrationPlan{
 const stamp=sourceStamp(input);
 const activeImports=new Set(input.imports.filter(row=>row.withdrawnAt===null).map(row=>row.id));
 const costs=input.costs.filter(row=>activeImports.has(row.importId));
 const issues:MigrationIssue[]=[];
 const targets=collectTargets(input),nativeProfiles=input.nativeProfiles??[];
 const generatedProfiles=targets.flatMap(target=>targetProfiles(input,target,costs,stamp,issues));
 const nativeSlots=new Set(nativeProfiles.map(profile=>JSON.stringify([profile.accountId,profile.itemId,profile.variationId,profile.validFrom])));
 const profiles=generatedProfiles.filter(profile=>!nativeSlots.has(JSON.stringify([profile.accountId,profile.itemId,profile.variationId,profile.validFrom])));
 profiles.sort((a,b)=>a.accountId.localeCompare(b.accountId)||a.itemId.localeCompare(b.itemId)||(a.variationId??'').localeCompare(b.variationId??'')||a.validFrom.localeCompare(b.validFrom));
 const resolvedTargets=new Set(targets.filter(target=>target.sales.length
  ?target.sales.every(row=>activeAdProfile(nativeProfiles,row))
  :!!latestAdProfile(nativeProfiles,target.accountId,target.itemId,target.variationId))
  .map(target=>targetKey(target.accountId,target.itemId,target.variationId)));
 const unresolvedIssues=issues.filter(issue=>!resolvedTargets.has(targetKey(issue.accountId,issue.itemId,issue.variationId)));

 const legacyReconciled=applyReconciliation(input.sales,costs,input.reconciliationEvents);
 const legacySales=applyFullClosures(legacyReconciled,input.fullClosures);
 const migrationBase=legacyReconciled.map(original=>{
  const sale={...original};
  delete sale.costSku;delete sale.linkRevision;delete sale.linkValidFrom;delete sale.adProfile;
  if(sale.operation?.source==='product')delete sale.operation;
  return sale;
 });
 const migratedSales=applyFullClosures(applyAdProfiles(migrationBase,[...profiles,...nativeProfiles]),input.fullClosures);
 let blockingDifferences=unresolvedIssues.filter(issue=>issue.code==='ambiguous_cost').length;
 for(let index=0;index<legacySales.length;index++){
  const legacySale=legacySales[index],migratedSale=migratedSales[index];if(!migratedSale)continue;
  const before=projectionValues(calculateSale(legacySale,costs));
  const after=projectionValues(calculateSale(migratedSale,[]));
  if(JSON.stringify(before)===JSON.stringify(after)||activeAdProfile(nativeProfiles,migrationBase[index]))continue;
  blockingDifferences++;
  addIssue(unresolvedIssues,{accountId:legacySale.accountId,itemId:legacySale.itemId??'',variationId:legacySale.variationId??null,code:'projection_difference',message:`A venda ${legacySale.orderId} mudaria de ${JSON.stringify(before)} para ${JSON.stringify(after)}.`});
 }
 unresolvedIssues.sort((a,b)=>a.accountId.localeCompare(b.accountId)||a.itemId.localeCompare(b.itemId)||(a.variationId??'').localeCompare(b.variationId??'')||a.code.localeCompare(b.code)||a.message.localeCompare(b.message));
 return {sourceStamp:stamp,profiles,issues:unresolvedIssues,comparedSales:legacySales.length,blockingDifferences};
}

type ImportRow={id:string;accountId:string;withdrawnAt:string|null};
type OrderRow={data:string};
type RolloutRow={state:string;sourceStamp:string};
type NativeProfileRow=Omit<AdProfileEvent,'variationId'|'payload'|'action'|'origin'>&{variationId:string;payload:string|null;action:string;origin:string};

function nativeProfileFromRow(row:NativeProfileRow):AdProfileEvent|null{try{
 if(row.action!=='set'&&row.action!=='clear'||row.origin!=='native')return null;
 const payload=row.payload===null?null:JSON.parse(row.payload) as AdProfilePayload;
 if(row.action==='set'&&!payload)return null;
 return {...row,variationId:row.variationId===''?null:row.variationId,action:row.action,origin:'native',payload};
 }catch{return null;}}

export async function loadLegacyWorkspace(db:D1Database,ownerId:string):Promise<LegacyWorkspace>{
 const results=await db.batch([
  db.prepare('SELECT id,account_id AS accountId,withdrawn_at AS withdrawnAt FROM imports WHERE owner_id=? ORDER BY id').bind(ownerId),
  db.prepare('SELECT id,account_id AS accountId,import_id AS importId,sku,description,unit_cost AS unitCost,tax_value AS taxValue,tax_type AS taxType,tax_treatment AS taxTreatment,valid_from AS validFrom,imported_at AS importedAt FROM cost_versions WHERE owner_id=? ORDER BY account_id,sku,valid_from,imported_at,id').bind(ownerId),
  db.prepare('SELECT data FROM meli_orders WHERE owner_id=? ORDER BY date,order_id,id').bind(ownerId),
  db.prepare('SELECT id,account_id AS accountId,target_type AS targetType,target_key AS targetKey,valid_from AS validFrom,revision,action,payload,source_stamp AS sourceStamp,reason,created_at AS createdAt FROM reconciliation_events WHERE owner_id=? ORDER BY created_at,revision,id').bind(ownerId),
  db.prepare("SELECT id,account_id AS accountId,item_id AS itemId,variation_id AS variationId,valid_from AS validFrom,revision,action,payload,request_id AS requestId,reason,origin,created_at AS createdAt FROM ad_profile_events WHERE owner_id=? AND origin='native' ORDER BY created_at,revision,id").bind(ownerId),
 ]);
 const imports=results[0].results as unknown as ImportRow[];
 const costs=results[1].results as unknown as CostRecord[];
 const sales=(results[2].results as unknown as OrderRow[]).flatMap(row=>{try{return JSON.parse(row.data) as Sale[];}catch{return [];}});
 const reconciliationEvents=reconciliationEventsFromRows(results[3].results as unknown as ReconciliationEventRow[]);
 const nativeProfiles=(results[4].results as unknown as NativeProfileRow[]).map(nativeProfileFromRow).filter((event):event is AdProfileEvent=>event!==null);
 const {loadFullClosures}=await import('./full-closure-store.ts');
 const fullClosures=await loadFullClosures(db,ownerId);
 return {ownerId,imports,costs,sales,reconciliationEvents,fullClosures,nativeProfiles};
}

async function rollout(db:D1Database,ownerId:string){
 return db.prepare('SELECT state,source_stamp AS sourceStamp FROM ad_profile_rollouts WHERE owner_id=?').bind(ownerId).first<RolloutRow>();
}
async function persistedProfileCount(db:D1Database,ownerId:string){
 const row=await db.prepare("SELECT COUNT(*) AS count FROM ad_profile_events WHERE owner_id=? AND origin='legacy'").bind(ownerId).first<{count:number}>();
 return Number(row?.count??0);
}
function report(plan:MigrationPlan){return JSON.stringify({profileCount:plan.profiles.length,issueCount:plan.issues.length,issues:plan.issues,comparedSales:plan.comparedSales,blockingDifferences:plan.blockingDifferences});}

export function migrationRolloutState(savedState:string|undefined,hasLegacyFinancialSources:boolean):MigrationRolloutState{
 if(savedState==='active'||savedState==='blocked')return savedState;
 return hasLegacyFinancialSources?'pending':'active';
}

function hasLegacyFinancialSources(workspace:LegacyWorkspace){
 const activeImports=new Set(workspace.imports.filter(row=>row.withdrawnAt===null).map(row=>row.id));
 return workspace.costs.some(row=>activeImports.has(row.importId))||workspace.reconciliationEvents.length>0;
}

export async function getAdProfileMigrationStatus(db:D1Database,ownerId:string):Promise<MigrationStatus>{
 const workspace=await loadLegacyWorkspace(db,ownerId),plan=buildAdProfileMigration(workspace);
 const saved=await rollout(db,ownerId);
 const savedState=saved?.state==='blocked'&&saved.sourceStamp!==plan.sourceStamp?undefined:saved?.state;
 const state=migrationRolloutState(savedState,hasLegacyFinancialSources(workspace));
 return {...plan,state,persistedProfileCount:await persistedProfileCount(db,ownerId)};
}

export async function activateAdProfileMigration(db:D1Database,ownerId:string,expectedSourceStamp:string):Promise<MigrationPlan>{
 const plan=buildAdProfileMigration(await loadLegacyWorkspace(db,ownerId));
 if(plan.sourceStamp!==expectedSourceStamp){const {HttpError}=await import('./server.ts');throw new HttpError(409,'Os dados de origem mudaram. Atualize a prévia antes de ativar a migração.');}
 const saved=await rollout(db,ownerId);
 if(saved?.state==='active')return plan;
 const now=new Date().toISOString();
 if(plan.blockingDifferences>0){
  await db.prepare(`INSERT INTO ad_profile_rollouts(owner_id,state,source_stamp,report,activated_at,updated_at) VALUES(?,'blocked',?,?,NULL,?)
   ON CONFLICT(owner_id) DO UPDATE SET state='blocked',source_stamp=excluded.source_stamp,report=excluded.report,activated_at=NULL,updated_at=excluded.updated_at`)
   .bind(ownerId,plan.sourceStamp,report(plan),now).run();
  return plan;
 }
 const statements:D1PreparedStatement[]=[];
 if(plan.profiles.length){
  const rows=plan.profiles.map(profile=>({
   id:profile.id,accountId:profile.accountId,itemId:profile.itemId,variationId:profile.variationId??'',validFrom:profile.validFrom,revision:profile.revision,
   requestId:profile.requestId,action:profile.action,payload:JSON.stringify(profile.payload),origin:profile.origin,reason:profile.reason,createdAt:profile.createdAt,
  }));
  statements.push(db.prepare(`INSERT INTO ad_profile_events(id,owner_id,account_id,item_id,variation_id,valid_from,revision,request_id,action,payload,origin,reason,created_at)
   SELECT json_extract(value,'$.id'),?,json_extract(value,'$.accountId'),json_extract(value,'$.itemId'),json_extract(value,'$.variationId'),json_extract(value,'$.validFrom'),json_extract(value,'$.revision'),json_extract(value,'$.requestId'),json_extract(value,'$.action'),json_extract(value,'$.payload'),json_extract(value,'$.origin'),json_extract(value,'$.reason'),json_extract(value,'$.createdAt') FROM json_each(?)`).bind(ownerId,JSON.stringify(rows)));
 }
 statements.push(db.prepare(`INSERT INTO ad_profile_rollouts(owner_id,state,source_stamp,report,activated_at,updated_at) VALUES(?,'active',?,?,?,?)
  ON CONFLICT(owner_id) DO UPDATE SET state='active',source_stamp=excluded.source_stamp,report=excluded.report,activated_at=excluded.activated_at,updated_at=excluded.updated_at`)
  .bind(ownerId,plan.sourceStamp,report(plan),now,now));
 await db.batch(statements);
 return plan;
}
