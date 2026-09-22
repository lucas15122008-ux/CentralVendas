import test from 'node:test';
import assert from 'node:assert/strict';
import {collectPending,sortPendingItems,type PendingItem} from '../lib/pending.ts';
import {calculateSale,groupProducts,summarizeSales,type CostRecord,type Sale,type SaleResult} from '../lib/finance.ts';
import type {MeliListing} from '../lib/meli/catalog.ts';
import type {AdProfileEvent} from '../lib/ad-profiles.ts';
import {saleCorrectionSourceStamp,type SaleCorrectionEvent} from '../lib/sale-corrections.ts';
import type {FullClosure} from '../lib/full-reconciliation.ts';
import {projectSales} from '../lib/sale-projection.ts';
import {demoWorkspace} from '../lib/demo.ts';

const accountId='10000000-0000-4000-8000-000000000001';
function sale(overrides:Partial<Sale>={}):Sale{return {
 id:'sale-1',orderId:'order-1',accountId,sku:'SKU-1',itemId:'MLB-1',variationId:null,title:'Produto',date:'2026-09-15',quantity:1,costQuantity:1,
 grossSalesCents:50_000,revenueCents:50_000,feeCents:5_000,shippingCents:2_000,otherCents:0,status:'paid',operation:{channel:'other',source:'meli'},...overrides,
};}
function profile(overrides:Partial<AdProfileEvent>={}):AdProfileEvent{return {
 id:'profile-1',accountId,itemId:'MLB-1',variationId:null,validFrom:'2026-01-01',revision:1,action:'set',
 payload:{unitCostTenThousandths:1_000_000,tax:{mode:'included'},operation:'auto'},requestId:'request-1',reason:'Ficha',origin:'native',createdAt:'2026-01-01T00:00:00Z',...overrides,
};}
function listing(overrides:Partial<MeliListing>={}):MeliListing{return {
 id:'listing-1',accountId,itemId:'MLB-1',variationId:null,title:'Produto',status:'active',sellerSku:'SKU-1',updatedAt:1,hasProfile:true,...overrides,
};}
function result(value:Sale,costs:CostRecord[]=[]):SaleResult{return calculateSale(value,costs);}

test('gera cada tipo de pendência com ID estável',()=>{
 const legacyCost:CostRecord={id:'cost',accountId,importId:'import',sku:'SKU-1',description:'Produto',unitCost:100,taxValue:null,taxType:'unit',taxTreatment:'unknown',validFrom:'2026-01-01',importedAt:'2026-01-01T00:00:00Z'};
 const rows:SaleResult[]=[
  result(sale({id:'missing-cost',orderId:'missing-cost',itemId:undefined,sku:'SEM-CUSTO'})),
  result(sale({id:'missing-tax',orderId:'missing-tax'}),[legacyCost]),
  result(sale({id:'missing-field',orderId:'missing-field',revenueCents:null,adProfile:{eventId:'p',revision:1,validFrom:'2026-01-01',unitCostTenThousandths:1_000_000,tax:{mode:'included'}}})),
  result(sale({id:'unknown-operation',orderId:'unknown-operation',operation:{channel:'unknown',source:'unknown'},adProfile:{eventId:'p',revision:1,validFrom:'2026-01-01',unitCostTenThousandths:1_000_000,tax:{mode:'included'}}})),
  result(sale({id:'first-full',orderId:'first-full',operation:{channel:'full',source:'meli'},adProfile:{eventId:'p',revision:1,validFrom:'2026-01-01',unitCostTenThousandths:1_000_000,tax:{mode:'included'}}})),
  result(sale({id:'stale-correction',orderId:'stale-correction',correctionState:'stale',adProfile:{eventId:'p',revision:1,validFrom:'2026-01-01',unitCostTenThousandths:1_000_000,tax:{mode:'included'}}})),
  result(sale({id:'stale-full',orderId:'stale-full',operation:{channel:'full',source:'meli'},fullClosureState:'stale',adProfile:{eventId:'p',revision:1,validFrom:'2026-01-01',unitCostTenThousandths:1_000_000,tax:{mode:'included'}}})),
 ];
 const input={sales:rows,listings:[listing(),listing({id:'listing-no-sale',itemId:'MLB-NO-SALE',title:'Sem venda',hasProfile:false})],migrationIssues:[{accountId,itemId:'MLB-CONFLICT',variationId:null,code:'projection_difference' as const,message:'A projeção mudaria.'}]};
 const first=collectPending(input),second=collectPending(input);
 const kinds=new Set(first.map(item=>item.kind));
 for(const kind of ['missing_profile','missing_cost','missing_tax','missing_meli_field','unknown_operation','missing_full_reference','stale_correction','stale_full_closure','migration_conflict'])assert.ok(kinds.has(kind as never),kind);
 assert.deepEqual(first.map(item=>item.id),second.map(item=>item.id));
 assert.equal(new Set(first.map(item=>item.id)).size,first.length);
 assert.equal(first.find(item=>item.kind==='missing_meli_field')?.field,'revenueCents');
});

test('custo e imposto zero declarados não criam pendência',()=>{
 const zero=result(sale({adProfile:{eventId:'zero',revision:1,validFrom:'2026-01-01',unitCostTenThousandths:0,tax:{mode:'unit',valueTenThousandths:0}}}));
 const pending=collectPending({sales:[zero],listings:[listing({hasProfile:true})],migrationIssues:[]});
 assert.equal(pending.some(item=>['missing_profile','missing_cost','missing_tax'].includes(item.kind)),false);
});

test('ordena itens para revisar antes dos dados ausentes',()=>{
 const item=(kind:PendingItem['kind'],id:string):PendingItem=>({id,kind,accountId,title:id,message:id,action:kind.includes('full')?'review_full':kind==='migration_conflict'?'review_migration':kind==='stale_correction'?'correct_sale':'edit_profile'});
 const sorted=sortPendingItems([
  item('missing_profile','perfil'),item('missing_meli_field','campo'),item('stale_full_closure','full'),item('migration_conflict','migração'),item('stale_correction','correção'),
 ]);
 assert.deepEqual(sorted.map(row=>row.id),['correção','full','migração','campo','perfil']);
});

test('projeção ativa usa ficha, API, fechamento e a mesma contribuição em todas as visões',()=>{
 const raw=sale({operation:undefined,logisticType:'fulfillment'});
 const closure:FullClosure={id:'closure',accountId,month:'2026-09',revision:1,action:'set',totalExpenseCents:1_000,eligibleUnits:1,sourceStamp:'stamp',reason:'Full',createdAt:'2026-10-01T00:00:00Z',allocations:[{saleId:raw.id,units:1,expenseCents:1_000}]};
 const input={rawSales:[raw],legacyCosts:[],reconciliationEvents:[],profiles:[profile()],corrections:[],closures:[closure],rolloutState:'active' as const};
 const projected=projectSales(input);
 assert.equal(projected.results[0].contributionCents,32_000);
 const summary=summarizeSales(projected.sales,projected.calculationCosts);
 assert.equal(summary.contributionCents,32_000);
 assert.equal(groupProducts(summary.rows)[0].profit,32_000);
 assert.equal(collectPending({sales:projected.results,listings:[listing({hasProfile:true})],migrationIssues:[]}).length,0);

 const noProfile=projectSales({...input,profiles:[]});
 assert.equal(noProfile.results[0].contributionCents,null);assert.ok(noProfile.results[0].reasons.some(reason=>/Custo/.test(reason)));
 const noFee=projectSales({...input,rawSales:[{...raw,feeCents:null}]});
 assert.equal(noFee.results[0].contributionCents,null);assert.ok(noFee.results[0].reasons.some(reason=>/Tarifa/.test(reason)));
 const noFull=projectSales({...input,closures:[]});
 assert.equal(noFull.results[0].contributionCents,null);assert.ok(noFull.results[0].reasons.some(reason=>/Full/.test(reason)));
});

test('rollout pendente preserva custo legado e rollout ativo preserva ajuste completo histórico',()=>{
 const legacyCost:CostRecord={id:'cost',accountId,importId:'import',sku:'SKU-1',description:'Produto',unitCost:1,taxValue:0,taxType:'unit',taxTreatment:'included',validFrom:'2026-01-01',importedAt:'2026-01-01T00:00:00Z'};
 const pending=projectSales({rawSales:[sale()],legacyCosts:[legacyCost],reconciliationEvents:[],profiles:[profile()],corrections:[],closures:[],rolloutState:'blocked'});
 assert.equal(pending.results[0].costCents,100);
 const base=pending.sales[0];
 const adjustment={id:'adjust',accountId,targetType:'sale' as const,targetKey:base.id,validFrom:'',revision:1,action:'set' as const,payload:{kind:'sale' as const,channel:'other' as const,amounts:{revenueCents:50_000,feeCents:5_000,shippingCents:2_000,otherCents:0,costCents:123,taxCents:0,fullExpenseCents:0}},sourceStamp:base.sourceStamp!,reason:'Histórico',createdAt:'2026-01-02T00:00:00Z'};
 const active=projectSales({rawSales:[sale()],legacyCosts:[legacyCost],reconciliationEvents:[adjustment],profiles:[profile()],corrections:[],closures:[],rolloutState:'active'});
 assert.equal(active.results[0].resultState,'manual');assert.equal(active.results[0].costCents,123);
});

test('correção por campo participa da projeção ativa',()=>{
 const raw=sale({sourceStamp:'source',otherCents:null});
 const correction:SaleCorrectionEvent={id:'correction',accountId,saleId:raw.id,field:'otherCents',revision:1,action:'set',mode:'fallback',value:700,sourceValue:null,sourceStamp:saleCorrectionSourceStamp(raw,'otherCents'),requestId:'request',reason:'Extrato',createdAt:'2026-01-01T00:00:00Z'};
 const projected=projectSales({rawSales:[raw],legacyCosts:[],reconciliationEvents:[],profiles:[profile()],corrections:[correction],closures:[],rolloutState:'active'});
 assert.equal(projected.sales[0].otherCents,700);assert.equal(projected.sales[0].fieldSources?.otherCents,'manual_fallback');
});

test('demonstração usa fichas nativas, inclui Full e mantém uma única pendência',()=>{
 const demo=demoWorkspace();
 assert.equal(demo.costs.length,0);assert.equal(demo.imports.length,0);assert.equal(demo.reconciliationEvents.length,0);assert.equal(demo.rollout.state,'active');
 assert.ok(demo.adProfiles.some(item=>item.payload?.operation==='full'));
 assert.ok(demo.sales.some(item=>item.operation?.channel==='full'&&item.fullExpense?.state==='estimated'));
 assert.equal(demo.pending.length,1);assert.equal(demo.pending[0].kind,'missing_profile');
});
