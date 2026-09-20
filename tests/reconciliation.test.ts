import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateSale,saleBreakdownRows,type Sale,type CostRecord} from '../lib/finance.ts';

const sale:Sale={id:'a:1:0',orderId:'1',accountId:'a',sku:'64265',itemId:'MLB1',variationId:null,title:'Radiador',date:'2026-09-17',quantity:1,costQuantity:1,revenueCents:20000,grossSalesCents:20000,feeCents:2000,shippingCents:1000,otherCents:0,status:'paid'};
const cost:CostRecord={id:'c',accountId:'a',sku:'64265',description:'Radiador',unitCost:100,taxValue:0,taxType:'unit',taxTreatment:'included',validFrom:'2026-09-15',importedAt:'2026-09-15',importId:'i'};

test('mesmo SKU mantém custo e desconta despesa Full apenas na venda ajustada',()=>{
 const common=calculateSale(sale,[cost]);
 const full=calculateSale({...sale,id:'a:2:0',revenueCents:25000,reconciliation:{state:'manual',channel:'full',amounts:{revenueCents:25000,feeCents:2500,shippingCents:1000,otherCents:0,costCents:10000,taxCents:0,fullExpenseCents:1500}}},[cost]);
 assert.equal(common.costCents,10000);assert.equal(full.costCents,10000);assert.equal(full.contributionCents,10000);assert.equal(full.resultState,'manual');
});
test('ajuste parcial não transforma imposto desconhecido em zero',()=>{
 const result=calculateSale({...sale,reconciliation:{state:'manual',channel:'full',amounts:{revenueCents:20000,feeCents:2000,shippingCents:1000,otherCents:0,costCents:10000,taxCents:null,fullExpenseCents:500}}},[]);
 assert.equal(result.costCents,10000);assert.equal(result.contributionCents,null);assert.ok(result.reasons.some(x=>x.includes('Imposto')));
});
test('ajuste desatualizado impede contribuição mesmo com valores automáticos completos',()=>{
 assert.equal(calculateSale({...sale,reconciliation:{state:'stale',channel:'unknown'}},[cost]).contributionCents,null);
});
test('vínculo explícito usa custo do SKU destino sem perder SKU original',()=>{
 const result=calculateSale({...sale,sku:'OUTRO',costSku:'64265'},[cost]);
 assert.equal(result.costCents,10000);assert.equal(result.sku,'OUTRO');
});
test('detalhe financeiro mostra separadamente a despesa Full descontada',()=>{
 const result=calculateSale({...sale,reconciliation:{state:'manual',channel:'full',amounts:{revenueCents:25000,feeCents:2500,shippingCents:1000,otherCents:0,costCents:10000,taxCents:0,fullExpenseCents:1500}}},[cost]);
 assert.deepEqual(saleBreakdownRows(result).find(row=>row.label==='Despesa adicional Full'),{label:'Despesa adicional Full',value:-1500});
});
