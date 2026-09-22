import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAdProfileMigration,migrationRolloutState,type LegacyWorkspace} from '../lib/ad-profile-migration.ts';
import type {CostRecord,Sale} from '../lib/finance.ts';
import {applyReconciliation,productTargetKey,saleSourceStamp,type ReconciliationEvent} from '../lib/reconciliation.ts';
import type {FullClosure} from '../lib/full-reconciliation.ts';
import type {AdProfileEvent} from '../lib/ad-profiles.ts';

const accountId='10000000-0000-4000-8000-000000000001';
const activeImport={id:'import-active',accountId,withdrawnAt:null};

function cost(overrides:Partial<CostRecord>={}):CostRecord{return {
 id:'cost-1',accountId,importId:activeImport.id,sku:'64265',description:'Radiador',unitCost:100.005,
 taxValue:0,taxType:'unit',taxTreatment:'included',validFrom:'2026-01-01',importedAt:'2026-01-01T10:00:00Z',...overrides,
};}
function sale(overrides:Partial<Sale>={}):Sale{return {
 id:'sale-1',orderId:'order-1',accountId,sku:'64265',title:'Radiador',itemId:'MLB-1',variationId:null,
 date:'2026-02-01',quantity:2,costQuantity:2,grossSalesCents:50_000,revenueCents:50_000,
 feeCents:5_000,shippingCents:2_000,otherCents:0,status:'paid',source:'mercadolivre',...overrides,
};}
function link(overrides:Partial<ReconciliationEvent>={}):ReconciliationEvent{return {
 id:'link-1',accountId,targetType:'product',targetKey:productTargetKey('MLB-1',null),validFrom:'2026-01-15',revision:1,
 action:'set',payload:{kind:'product',sku:'64265',channel:'other'},sourceStamp:null,reason:'Vínculo legado',createdAt:'2026-01-15T00:00:00Z',...overrides,
};}
function nativeProfile(overrides:Partial<AdProfileEvent>={}):AdProfileEvent{return {
 id:'native-1',accountId,itemId:'MLB-1',variationId:null,validFrom:'2026-01-01',revision:1,action:'set',
 payload:{unitCostTenThousandths:900_000,tax:{mode:'included'},operation:'auto'},requestId:'native-request',
 reason:'Valor revisado pelo usuário',origin:'native',createdAt:'2026-09-22T12:00:00Z',...overrides,
};}
function workspace(overrides:Partial<LegacyWorkspace>={}):LegacyWorkspace{return {
 ownerId:'owner-1',imports:[activeImport],costs:[cost()],sales:[sale()],reconciliationEvents:[],fullClosures:[],nativeProfiles:[],...overrides,
};}

test('migra vínculo explícito e todas as vigências determinísticas do custo',()=>{
 const plan=buildAdProfileMigration(workspace({
  costs:[cost(),cost({id:'cost-2',unitCost:110.1234,taxTreatment:'additional',taxType:'percent',taxValue:12.34,validFrom:'2026-03-01',importedAt:'2026-03-01T10:00:00Z'})],
  sales:[sale(),sale({id:'sale-2',orderId:'order-2',date:'2026-04-01'})],reconciliationEvents:[link()],
 }));
 assert.equal(plan.comparedSales,2);
 assert.equal(plan.blockingDifferences,0);
 assert.equal(plan.issues.length,0);
 assert.deepEqual(plan.profiles.map(profile=>({validFrom:profile.validFrom,payload:profile.payload,origin:profile.origin})),[
  {validFrom:'2026-01-15',payload:{unitCostTenThousandths:1_000_050,tax:{mode:'included'},operation:'other'},origin:'legacy'},
  {validFrom:'2026-03-01',payload:{unitCostTenThousandths:1_101_234,tax:{mode:'percent',rateBasisPoints:1_234},operation:'other'},origin:'legacy'},
 ]);
 assert.equal(plan.sourceStamp,buildAdProfileMigration(workspace({
  costs:[cost(),cost({id:'cost-2',unitCost:110.1234,taxTreatment:'additional',taxType:'percent',taxValue:12.34,validFrom:'2026-03-01',importedAt:'2026-03-01T10:00:00Z'})],
  sales:[sale(),sale({id:'sale-2',orderId:'order-2',date:'2026-04-01'})],reconciliationEvents:[link()],
 })).sourceStamp);
});

test('infere somente SKU exato único e nunca usa título ou preço',()=>{
 const exact=buildAdProfileMigration(workspace({reconciliationEvents:[]}));
 assert.equal(exact.profiles.length,1);
 assert.equal(exact.blockingDifferences,0);

 const ambiguous=buildAdProfileMigration(workspace({
  costs:[cost(),cost({id:'cost-other',sku:'OUTRO'})],
  sales:[sale(),sale({id:'sale-2',orderId:'order-2',sku:'OUTRO',date:'2026-02-02'})],
 }));
 assert.equal(ambiguous.profiles.length,0);
 assert.ok(ambiguous.issues.some(issue=>issue.code==='ambiguous_cost'));
 assert.ok(ambiguous.blockingDifferences>=2);

 const noTitleMatch=buildAdProfileMigration(workspace({sales:[sale({sku:'SEM-SKU',title:'Radiador'})]}));
 assert.ok(noTitleMatch.issues.some(issue=>issue.code==='missing_cost'));
 assert.equal(noTitleMatch.profiles.length,0);
});

test('ignora import retirado, bloqueia imposto desconhecido e assina essa origem',()=>{
 const withdrawn={id:'import-withdrawn',accountId,withdrawnAt:'2026-02-10T00:00:00Z'};
 const withdrawnPlan=buildAdProfileMigration(workspace({
  imports:[activeImport,withdrawn],costs:[cost({importId:withdrawn.id,unitCost:1}),cost({id:'active',unitCost:99})],
 }));
 assert.equal(withdrawnPlan.profiles[0]?.payload?.unitCostTenThousandths,990_000);
 const changedStamp=buildAdProfileMigration(workspace({
  imports:[activeImport,{...withdrawn,withdrawnAt:null}],costs:[cost({importId:withdrawn.id,unitCost:1}),cost({id:'active',unitCost:99})],
 })).sourceStamp;
 assert.notEqual(withdrawnPlan.sourceStamp,changedStamp);

 const unknown=buildAdProfileMigration(workspace({costs:[cost({taxTreatment:'unknown',taxValue:null})]}));
 assert.equal(unknown.profiles.length,0);
 assert.ok(unknown.issues.some(issue=>issue.code==='unknown_tax'));
 assert.equal(unknown.blockingDifferences,1);
});

test('custo concorrente na mesma vigência bloqueia até uma ficha nativa resolver o alvo',()=>{
 const plan=buildAdProfileMigration(workspace({costs:[
  cost({id:'a',unitCost:80,importedAt:'2026-01-01T10:00:00Z'}),
  cost({id:'b',unitCost:90,importedAt:'2026-01-02T10:00:00Z'}),
 ]}));
 assert.equal(plan.profiles.length,1);
 assert.equal(plan.profiles[0].payload?.unitCostTenThousandths,900_000);
 assert.ok(plan.issues.some(issue=>issue.code==='ambiguous_cost'));
 assert.ok(plan.blockingDifferences>0);

 const resolved=buildAdProfileMigration(workspace({
  costs:[
   cost({id:'a',unitCost:80,importedAt:'2026-01-01T10:00:00Z'}),
   cost({id:'b',unitCost:90,importedAt:'2026-01-02T10:00:00Z'}),
  ],
  nativeProfiles:[nativeProfile()],
 }));
 assert.equal(resolved.profiles.length,0);
 assert.equal(resolved.issues.length,0);
 assert.equal(resolved.blockingDifferences,0);
});

test('SKU 64265 gera fichas independentes para anúncio Full e comum',()=>{
 const full=sale({id:'sale-full',orderId:'full',itemId:'MLB-FULL',logisticType:'fulfillment'});
 const common=sale({id:'sale-common',orderId:'common',itemId:'MLB-COMMON',logisticType:'cross_docking'});
 const plan=buildAdProfileMigration(workspace({sales:[full,common],reconciliationEvents:[
  link({id:'full-link',targetKey:productTargetKey('MLB-FULL',null),payload:{kind:'product',sku:'64265',channel:'full'}}),
  link({id:'common-link',targetKey:productTargetKey('MLB-COMMON',null),payload:{kind:'product',sku:'64265',channel:'other'}}),
 ]}));
 assert.equal(plan.blockingDifferences,0);
 assert.deepEqual(plan.profiles.map(profile=>[profile.itemId,profile.payload?.operation]),[['MLB-COMMON','other'],['MLB-FULL','full']]);
});

test('preserva ajuste completo de venda histórica e fechamento Full',()=>{
 const raw=sale({itemId:'MLB-MANUAL',logisticType:'fulfillment'});
 const linked=applyReconciliation([raw],[cost()],[])[0];
 const adjustment:ReconciliationEvent={
  id:'adjust-1',accountId,targetType:'sale',targetKey:raw.id,validFrom:'',revision:1,action:'set',
  payload:{kind:'sale',channel:'full',amounts:{revenueCents:50_000,feeCents:5_000,shippingCents:2_000,otherCents:0,costCents:20_001,taxCents:0,fullExpenseCents:999}},
  sourceStamp:saleSourceStamp(linked,cost()),reason:'Venda já conferida',createdAt:'2026-02-02T00:00:00Z',
 };
 const closure:FullClosure={
  id:'closure-1',accountId,month:'2026-02',revision:1,action:'set',totalExpenseCents:1_001,eligibleUnits:2,
  sourceStamp:'source',reason:'Fechamento',createdAt:'2026-03-01T00:00:00Z',allocations:[{saleId:raw.id,units:2,expenseCents:1_001}],
 };
 const plan=buildAdProfileMigration(workspace({sales:[raw],reconciliationEvents:[adjustment],fullClosures:[closure]}));
 assert.equal(plan.comparedSales,1);
 assert.equal(plan.blockingDifferences,0);
 assert.equal(plan.profiles.length,1);
 assert.equal(closure.allocations[0].expenseCents,1_001);
});

test('diferença por venda bloqueia a ativação e identifica o alvo',()=>{
 const plan=buildAdProfileMigration(workspace({costs:[cost({taxTreatment:'unknown',taxValue:null})]}));
 assert.equal(plan.comparedSales,1);
 assert.equal(plan.blockingDifferences,1);
 assert.ok(plan.issues.some(issue=>issue.code==='unknown_tax'));
 const difference=plan.issues.find(issue=>issue.code==='projection_difference');
 assert.deepEqual(difference&&{accountId:difference.accountId,itemId:difference.itemId,variationId:difference.variationId},{accountId,itemId:'MLB-1',variationId:null});
});

test('proprietário sem dados legados produz plano vazio e ativável',()=>{
 const plan=buildAdProfileMigration(workspace({imports:[],costs:[],sales:[],reconciliationEvents:[],fullClosures:[],nativeProfiles:[]}));
 assert.equal(plan.profiles.length,0);
 assert.equal(plan.comparedSales,0);
 assert.equal(plan.blockingDifferences,0);
 assert.equal(plan.issues.length,0);
 assert.match(plan.sourceStamp,/^migration-v1:/);
});

test('proprietário sem fontes financeiras legadas entra direto no fluxo nativo',()=>{
 assert.equal(migrationRolloutState(undefined,false),'active');
 assert.equal(migrationRolloutState(undefined,true),'pending');
 assert.equal(migrationRolloutState('blocked',false),'blocked');
 assert.equal(migrationRolloutState('active',true),'active');
});

test('ficha nativa explica uma diferença e não colide com a ativação',()=>{
 const plan=buildAdProfileMigration(workspace({
  costs:[cost({taxTreatment:'unknown',taxValue:null})],
  nativeProfiles:[nativeProfile({payload:{unitCostTenThousandths:1_000_050,tax:{mode:'included'},operation:'auto'}})],
 }));
 assert.equal(plan.profiles.length,0);
 assert.equal(plan.issues.length,0);
 assert.equal(plan.blockingDifferences,0);
});
