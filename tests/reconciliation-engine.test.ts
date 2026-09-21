import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {CostRecord,Sale} from '../lib/finance.ts';
import {activeProductLink,applyReconciliation,initialReconciliationAmounts,productTargetKey,reconciliationStatus,resolveOperation,saleSourceStamp,type ReconciliationEvent} from '../lib/reconciliation.ts';

const sale:Sale={id:'a:1:0',orderId:'1',accountId:'a',sku:'SEM-SKU',itemId:'MLB1',variationId:'V1',title:'Radiador',date:'2026-09-17',quantity:1,costQuantity:1,revenueCents:25000,grossSalesCents:25000,feeCents:2500,shippingCents:1000,otherCents:0,status:'paid'};
const cost:CostRecord={id:'c',accountId:'a',sku:'64265',description:'Radiador',unitCost:100,taxValue:0,taxType:'unit',taxTreatment:'included',validFrom:'2026-09-15',importedAt:'2026-09-15',importId:'i'};
const event=(overrides:Partial<ReconciliationEvent>):ReconciliationEvent=>({id:'e',accountId:'a',targetType:'product',targetKey:productTargetKey('MLB1','V1'),validFrom:'2026-09-16',revision:1,action:'set',payload:{kind:'product',sku:'64265'},sourceStamp:null,reason:'Conferido',createdAt:'2026-09-17T12:00:00Z',...overrides});

test('vínculo de anúncio respeita conta, variação e data de vigência',()=>{
 const events=[event({}),event({id:'future',validFrom:'2026-09-18',revision:1,payload:{kind:'product',sku:'FUTURO'}}),event({id:'other',accountId:'b',payload:{kind:'product',sku:'OUTRA-CONTA'}})];
 const [applied]=applyReconciliation([sale],[cost],events);
 assert.equal(applied.costSku,'64265');
 assert.equal(applied.linkValidFrom,'2026-09-16');
 assert.equal(applied.linkRevision,1);
});

test('evento clear remove apenas a vigência correspondente do vínculo',()=>{
 const events=[event({revision:1}),event({id:'clear',revision:2,action:'clear',payload:null})];
 const [applied]=applyReconciliation([sale],[cost],events);
 assert.equal(applied.costSku,undefined);
});

test('ajuste manual só entra quando o retrato da venda e do custo continua igual',()=>{
 const link=event({});
 const [linked]=applyReconciliation([sale],[cost],[link]);
 const stamp=saleSourceStamp(linked,cost);
 const adjustment=event({id:'sale-event',targetType:'sale',targetKey:sale.id,validFrom:'',payload:{kind:'sale',channel:'full',amounts:{revenueCents:25000,feeCents:2500,shippingCents:1000,otherCents:0,costCents:10000,taxCents:0,fullExpenseCents:1500}},sourceStamp:stamp});
 const [manual]=applyReconciliation([sale],[cost],[link,adjustment]);
 assert.equal(manual.reconciliation?.state,'manual');
 const changedCost={...cost,id:'c2',unitCost:110,importedAt:'2026-09-17'};
 const [stale]=applyReconciliation([sale],[cost,changedCost],[link,adjustment]);
 assert.equal(stale.reconciliation?.state,'stale');
 assert.equal(stale.reconciliation?.amounts?.fullExpenseCents,1500);
});

test('ajuste anterior ao campo de logística continua válido quando a fonte não informou modalidade',()=>{
 const link=event({});
 const [linked]=applyReconciliation([{...sale,logisticType:null}],[cost],[link]);
 const legacySource=JSON.parse(saleSourceStamp(linked,cost)) as {sale:Record<string,unknown>;cost:Record<string,unknown>};
 delete legacySource.sale.logisticType;
 const adjustment=event({id:'legacy-adjustment',targetType:'sale',targetKey:sale.id,validFrom:'',payload:{kind:'sale',channel:'full',amounts:{revenueCents:25000,feeCents:2500,shippingCents:1000,otherCents:0,costCents:10000,taxCents:0,fullExpenseCents:0}},sourceStamp:JSON.stringify(legacySource)});
 assert.equal(applyReconciliation([{...sale,logisticType:null}],[cost],[link,adjustment])[0].reconciliation?.state,'manual');
 assert.equal(applyReconciliation([{...sale,logisticType:'fulfillment'}],[cost],[link,adjustment])[0].reconciliation?.state,'stale');
});

test('vínculo ativo preserva a classificação do anúncio',()=>{
 const full=event({payload:{kind:'product',sku:'64265',channel:'full'}});
 assert.equal(activeProductLink([full],sale)?.payload?.kind,'product');
 assert.equal(activeProductLink([full],sale)?.payload?.channel,'full');
});

test('maior revisão prevalece e o histórico pode chegar fora de ordem',()=>{
 const older=event({targetType:'sale',targetKey:sale.id,validFrom:'',revision:1,sourceStamp:'antigo',payload:{kind:'sale',channel:'other',amounts:{revenueCents:1,feeCents:0,shippingCents:0,otherCents:0,costCents:0,taxCents:0,fullExpenseCents:0}}});
 const newer=event({id:'new',targetType:'sale',targetKey:sale.id,validFrom:'',revision:2,action:'clear',payload:null});
 const [applied]=applyReconciliation([sale],[cost],[newer,older]);
 assert.equal(applied.saleRevision,2);
 assert.equal(applied.reconciliation,undefined);
});

test('reabrir ajuste parcial preserva valores desconhecidos em vez de preenchê-los',()=>{
 const amounts={revenueCents:25000,feeCents:2500,shippingCents:1000,otherCents:0,costCents:null,taxCents:null,fullExpenseCents:null};
 const adjusted:Sale={...sale,reconciliation:{state:'manual',channel:'full',amounts}};
 assert.deepEqual(initialReconciliationAmounts(adjusted,{revenueCents:25000,feeCents:2500,shippingCents:1000,otherCents:0,costCents:10000,taxCents:0,fullExpenseCents:0}),amounts);
});

test('ajuste manual parcial continua na fila de atenção',()=>{
 assert.equal(reconciliationStatus({contributionCents:null,reconciliation:{state:'manual',channel:'full'}}),'manual-pending');
 assert.equal(reconciliationStatus({contributionCents:1000,reconciliation:{state:'manual',channel:'full'}}),'manual');
});

test('envio oficial prevalece e divergência configurada fica visível',()=>{
 assert.deepEqual(resolveOperation('fulfillment','other','other'),{channel:'full',source:'meli',conflict:'A modalidade configurada diverge do envio do Mercado Livre.'});
 assert.deepEqual(resolveOperation('drop_off','full','full'),{channel:'other',source:'meli',conflict:'A modalidade configurada diverge do envio do Mercado Livre.'});
});

test('tipos não conclusivos permanecem desconhecidos',()=>{
 assert.deepEqual(resolveOperation('not_specified','unknown','unknown'),{channel:'unknown',source:'unknown'});
 assert.deepEqual(resolveOperation('nova_modalidade','unknown','unknown'),{channel:'unknown',source:'unknown'});
});

test('duas ofertas do SKU 64265 mantêm operações diferentes',()=>{
 const common:Sale={...sale,id:'a:2:0',orderId:'2',itemId:'MLB2',variationId:'V2'};
 const links=[event({payload:{kind:'product',sku:'64265',channel:'full'}}),event({id:'common-link',targetKey:productTargetKey('MLB2','V2'),payload:{kind:'product',sku:'64265',channel:'other'}})];
 const rows=applyReconciliation([sale,common],[cost],links);
 assert.deepEqual(rows.map(row=>row.operation?.channel),['full','other']);
 assert.deepEqual(rows.map(row=>row.costSku),['64265','64265']);
});

test('ajuste manual válido precede anúncio e ajuste obsoleto não classifica',()=>{
 const product=event({payload:{kind:'product',sku:'64265',channel:'full'}});
 const [linked]=applyReconciliation([sale],[cost],[product]);
 const adjustment=event({id:'manual-operation',targetType:'sale',targetKey:sale.id,validFrom:'',sourceStamp:linked.sourceStamp!,payload:{kind:'sale',channel:'other',amounts:{revenueCents:25000,feeCents:2500,shippingCents:1000,otherCents:0,costCents:10000,taxCents:0,fullExpenseCents:0}}});
 assert.deepEqual(applyReconciliation([sale],[cost],[product,adjustment])[0].operation,{channel:'other',source:'manual'});
 const unknownProduct=event({payload:{kind:'product',sku:'64265',channel:'unknown'}});
 assert.deepEqual(applyReconciliation([sale],[cost],[unknownProduct,{...adjustment,sourceStamp:'obsoleto'}])[0].operation,{channel:'unknown',source:'unknown'});
});
