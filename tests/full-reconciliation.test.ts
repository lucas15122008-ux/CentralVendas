import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {CostRecord,Sale} from '../lib/finance.ts';
import {allocateFullMonth,applyFullClosures,fullMonthSource,parseBrlCents,previewFullMonth,type FullClosure} from '../lib/full-reconciliation.ts';

const cost:CostRecord={id:'cost-64265',accountId:'a',sku:'64265',description:'Radiador',unitCost:100,taxValue:0,taxType:'unit',taxTreatment:'included',validFrom:'2026-01-01',importedAt:'2026-01-01T00:00:00Z',importId:'i'};
const sale=(id:string,overrides:Partial<Sale>={}):Sale=>({
 id,orderId:id,accountId:'a',sku:'SEM-SKU',costSku:'64265',itemId:'MLB-FULL',variationId:null,title:'Radiador',date:'2026-09-15',quantity:1,costQuantity:1,grossSalesCents:25000,revenueCents:25000,feeCents:2500,shippingCents:1000,otherCents:0,status:'paid',operation:{channel:'full',source:'product'},sourceStamp:`stamp-${id}`,...overrides,
});
const closure=(overrides:Partial<FullClosure>):FullClosure=>({
 id:'closure',accountId:'a',month:'2026-09',revision:1,action:'set',totalExpenseCents:1000,eligibleUnits:1,sourceStamp:'source',reason:'Demonstrativo mensal',createdAt:'2026-10-01T12:00:00Z',allocations:[],...overrides,
});

test('rateia dez mil reais em duzentas unidades e preserva o total',()=>{
 const preview=previewFullMonth([sale('s1',{costQuantity:1}),sale('s2',{costQuantity:2}),sale('s3',{costQuantity:197})],[cost],'a','2026-09');
 const allocations=allocateFullMonth(1_000_000,preview);
 assert.equal(preview.units,200);
 assert.deepEqual(allocations.map(row=>row.expenseCents),[5_000,10_000,985_000]);
 assert.equal(allocations.reduce((sum,row)=>sum+row.expenseCents,0),1_000_000);
});

test('centavos indivisíveis usam ordem estável da venda',()=>{
 const preview=previewFullMonth([sale('c'),sale('a'),sale('b')],[cost],'a','2026-09');
 assert.deepEqual(preview.eligible.map(row=>row.id),['a','b','c']);
 assert.deepEqual(allocateFullMonth(100,preview),[
  {saleId:'a',units:1,expenseCents:34},
  {saleId:'b',units:1,expenseCents:33},
  {saleId:'c',units:1,expenseCents:33},
 ]);
});

test('prévia isola conta e mês e explica vendas que não entram',()=>{
 const rows=[
  sale('full'),
  sale('common',{operation:{channel:'other',source:'product'}}),
  sale('pending',{status:'pending'}),
  sale('refunded',{status:'refunded'}),
  sale('unknown-quantity',{costQuantity:null}),
  sale('other-account',{accountId:'b'}),
  sale('other-month',{date:'2026-08-31'}),
 ];
 const preview=previewFullMonth(rows,[cost],'a','2026-09');
 assert.deepEqual(preview.eligible.map(row=>row.id),['full']);
 assert.deepEqual(preview.excluded.map(row=>row.saleId),['common','pending','refunded','unknown-quantity']);
 assert.ok(preview.excluded.every(row=>row.reason.length>0));
 assert.equal(preview.units,1);
});

test('mesmo SKU em oferta Full e comum inclui somente a Full',()=>{
 const preview=previewFullMonth([
  sale('full',{itemId:'MLB-FULL',operation:{channel:'full',source:'product'}}),
  sale('common',{itemId:'MLB-COMMON',operation:{channel:'other',source:'product'}}),
 ],[cost],'a','2026-09');
 assert.deepEqual(preview.eligible.map(row=>row.id),['full']);
});

test('despesa Full individual bloqueia dupla dedução',()=>{
 const manual=sale('manual',{reconciliation:{state:'manual',channel:'full',amounts:{revenueCents:25000,feeCents:2500,shippingCents:1000,otherCents:0,costCents:10000,taxCents:0,fullExpenseCents:1}}});
 const preview=previewFullMonth([manual],[cost],'a','2026-09');
 assert.equal(preview.conflicts.length,1);
 assert.throws(()=>allocateFullMonth(100,preview),/individual|manual|Full/i);
});

test('retrato mensal é estável e muda com fonte ou custo selecionado',()=>{
 const first=previewFullMonth([sale('b'),sale('a')],[cost],'a','2026-09');
 const second=previewFullMonth([sale('a'),sale('b')],[cost],'a','2026-09');
 assert.equal(fullMonthSource(first,[cost]),fullMonthSource(second,[cost]));
 const changedStamp=previewFullMonth([sale('a',{sourceStamp:'changed'}),sale('b')],[cost],'a','2026-09');
 assert.notEqual(fullMonthSource(first,[cost]),fullMonthSource(changedStamp,[cost]));
 assert.notEqual(fullMonthSource(first,[cost]),fullMonthSource(first,[{...cost,id:'new-cost'}]));
});

test('retrato mensal muda quando surge despesa Full individual',()=>{
 const original=previewFullMonth([sale('manual')],[cost],'a','2026-09');
 const adjusted=previewFullMonth([sale('manual',{reconciliation:{state:'manual',channel:'full',amounts:{revenueCents:25000,feeCents:2500,shippingCents:1000,otherCents:0,costCents:10000,taxCents:0,fullExpenseCents:500}}})],[cost],'a','2026-09');
 assert.notEqual(fullMonthSource(original,[cost]),fullMonthSource(adjusted,[cost]));
});

test('valores monetários brasileiros viram centavos somente quando exatos',()=>{
 assert.equal(parseBrlCents('R$ 10.000,00'),1_000_000);
 assert.equal(parseBrlCents('0,01'),1);
 assert.equal(parseBrlCents('10.000'),1_000_000);
 assert.equal(parseBrlCents('1,001'),null);
 assert.equal(parseBrlCents('-1,00'),null);
 assert.equal(parseBrlCents(''),null);
 assert.equal(parseBrlCents('R$ 999999999999999999,00'),null);
});

test('último fechamento anterior estima o mês aberto por unidade',()=>{
 const august=closure({id:'aug',month:'2026-08',totalExpenseCents:10_000,eligibleUnits:10});
 const [projected]=applyFullClosures([sale('sep',{costQuantity:2})],[august]);
 assert.deepEqual(projected.fullExpense,{cents:2_000,state:'estimated',month:'2026-09',unitRateCents:1_000});
});

test('estimativa do mês aberto preserva despesa Full individual',()=>{
 const august=closure({id:'aug',month:'2026-08',totalExpenseCents:10_000,eligibleUnits:10});
 const manual=sale('sep',{costQuantity:2,reconciliation:{state:'manual',channel:'full',amounts:{revenueCents:25000,feeCents:2500,shippingCents:1000,otherCents:0,costCents:10000,taxCents:0,fullExpenseCents:750}}});
 const [projected]=applyFullClosures([manual],[august]);
 assert.equal(projected.fullExpense,undefined);
});

test('fechamento atual substitui estimativa e a maior revisão prevalece',()=>{
 const august=closure({id:'aug',month:'2026-08',totalExpenseCents:10_000,eligibleUnits:10});
 const older=closure({id:'sep-old',revision:1,allocations:[{saleId:'sep',units:2,expenseCents:1_400}]});
 const latest=closure({id:'sep-new',revision:2,totalExpenseCents:1_500,eligibleUnits:2,allocations:[{saleId:'sep',units:2,expenseCents:1_500}]});
 const [projected]=applyFullClosures([sale('sep',{costQuantity:2})],[latest,august,older]);
 assert.deepEqual(projected.fullExpense,{cents:1_500,state:'closed',month:'2026-09',closureId:'sep-new',unitRateCents:750});
});

test('retirada reabre o mês e recupera a estimativa do fechamento anterior',()=>{
 const august=closure({id:'aug',month:'2026-08',totalExpenseCents:10_000,eligibleUnits:10});
 const set=closure({id:'sep-set',revision:1,allocations:[{saleId:'sep',units:2,expenseCents:1_500}]});
 const clear=closure({id:'sep-clear',revision:2,action:'clear',totalExpenseCents:null,eligibleUnits:0,sourceStamp:null,allocations:[]});
 const [projected]=applyFullClosures([sale('sep',{costQuantity:2})],[set,clear,august]);
 assert.deepEqual(projected.fullExpense,{cents:2_000,state:'estimated',month:'2026-09',unitRateCents:1_000});
});

test('fechamento de outra conta e primeiro mês não criam estimativa',()=>{
 const other=closure({accountId:'b',month:'2026-08',totalExpenseCents:10_000,eligibleUnits:10});
 const [projected]=applyFullClosures([sale('sep')],[other]);
 assert.equal(projected.fullExpense,undefined);
});

test('fechamento obsoleto marca as vendas afetadas sem aplicar valor final',()=>{
 const stale=closure({id:'stale',stale:true,allocations:[{saleId:'sep',units:1,expenseCents:1_000}]});
 const [projected]=applyFullClosures([sale('sep')],[stale]);
 assert.equal(projected.fullClosureState,'stale');
 assert.equal(projected.fullExpense,undefined);
});
