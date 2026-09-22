import { test } from 'node:test';
import assert from 'node:assert/strict';
import {calculateSale,summarizeSales,groupProducts} from '../lib/finance.ts';
import type {Sale,CostRecord} from '../lib/finance.ts';
import type {TaxRule} from '../lib/ad-profiles.ts';
const sale:Sale={id:'s',orderId:'o',accountId:'a',sku:'001',title:'Produto',date:'2026-09-10',quantity:2,costQuantity:2,revenueCents:20000,feeCents:3000,shippingCents:1000,otherCents:0,status:'paid'};
const cost:CostRecord={id:'c',accountId:'a',sku:'001',description:'Produto',unitCost:50,taxValue:5,taxType:'unit',taxTreatment:'included',validFrom:'2026-09-01',importedAt:'2026-09-11T00:00:00Z',importId:'i'};
test('imposto incluído não é deduzido novamente',()=>assert.equal(calculateSale(sale,[cost]).contributionCents,6000));
test('imposto adicional unitário usa a quantidade',()=>assert.equal(calculateSale(sale,[{...cost,taxTreatment:'additional'}]).contributionCents,5000));
test('imposto percentual usa receita líquida da linha',()=>assert.equal(calculateSale(sale,[{...cost,taxType:'percent',taxValue:6,taxTreatment:'additional'}]).contributionCents,4800));
test('ausência de custo não produz lucro artificial',()=>assert.equal(calculateSale(sale,[]).contributionCents,null));
test('imposto não classificado impede margem completa',()=>assert.equal(calculateSale(sale,[{...cost,taxTreatment:'unknown'}]).contributionCents,null));
test('imposto vazio difere de zero declarado',()=>{assert.equal(calculateSale(sale,[{...cost,taxValue:null,taxTreatment:'additional'}]).contributionCents,null);assert.equal(calculateSale(sale,[{...cost,taxValue:0,taxTreatment:'additional'}]).contributionCents,6000)});
test('custo futuro ou de outra conta não altera o passado',()=>assert.equal(calculateSale(sale,[{...cost,validFrom:'2026-09-12'},{...cost,accountId:'other'}]).contributionCents,null));
test('entre custos vigentes usa o mais recente',()=>assert.equal(calculateSale(sale,[cost,{...cost,unitCost:60,validFrom:'2026-09-09'}]).contributionCents,4000));
test('mesma vigência respeita última revisão importada',()=>assert.equal(calculateSale(sale,[cost,{...cost,unitCost:70,importedAt:'2026-09-12T00:00:00Z'}]).contributionCents,2000));
test('arredonda custo depois de multiplicar unidades',()=>assert.equal(calculateSale({...sale,quantity:3,costQuantity:3},[{...cost,unitCost:10.3333}]).costCents,3100));
test('cobertura informa receita sem custo e margem não é média simples',()=>{const r=summarizeSales([sale,{...sale,id:'x',orderId:'y',sku:'unknown',revenueCents:10000}],[cost]);assert.equal(r.revenueCents,30000);assert.equal(r.coveredRevenueCents,20000);assert.equal(r.contributionCents,6000);assert.equal(r.margin,30);assert.equal(r.orders,2)});
test('reembolso sem recuperação do estoque preserva custo consumido',()=>assert.equal(calculateSale({...sale,status:'refunded',revenueCents:0,feeCents:0,shippingCents:1000},[cost]).contributionCents,-11000));
test('SKU igual em contas diferentes não une produtos automaticamente',()=>{
 const rows=[calculateSale(sale,[cost]),calculateSale({...sale,accountId:'other',title:'Outro produto'},[])];
 const products=groupProducts(rows);assert.equal(products.length,2);assert.equal(products[0].profit,6000);assert.equal(products[1].complete,false);
});
test('pedidos iguais de contas diferentes são contados separadamente',()=>assert.equal(summarizeSales([sale,{...sale,accountId:'other'}],[cost]).orders,2));
test('valores desconhecidos do Mercado Livre impedem margem sem virar zero',()=>{const s:Sale={id:'ml',orderId:'1',accountId:'a',sku:'SKU',title:'Produto',date:'2026-09-01',quantity:1,costQuantity:1,revenueCents:null,feeCents:null,shippingCents:null,otherCents:0,status:'paid'};const result=calculateSale(s,[]);assert.equal(result.contributionCents,null);assert.ok(result.reasons.length>=4);assert.equal(summarizeSales([s],[]).unknownRevenue,1);});
test('faturamento informado soma vendas pagas mesmo com receita a conciliar',()=>{const pending:Sale={...sale,id:'pending',orderId:'pending',grossSalesCents:25000,revenueCents:null,feeCents:null,shippingCents:null};const refunded:Sale={...sale,id:'refunded',orderId:'refunded',status:'refunded',grossSalesCents:null,revenueCents:null};const result=summarizeSales([pending,refunded],[]);assert.equal(result.grossSalesCents,25000);assert.equal(result.revenueCents,0);assert.equal(result.unknownRevenue,2);assert.equal(result.coverage,0);});
test('fechamento mensal substitui zero manual e deduz uma vez',()=>{
 const manual:Sale={...sale,reconciliation:{state:'manual',channel:'full',amounts:{revenueCents:25000,feeCents:2500,shippingCents:1000,otherCents:0,costCents:10000,taxCents:0,fullExpenseCents:0}},fullExpense:{cents:1500,state:'closed',month:'2026-09',closureId:'c1',unitRateCents:1500}};
 const result=calculateSale(manual,[cost]);
 assert.equal(result.fullExpenseCents,1500);assert.equal(result.contributionCents,10000);assert.equal(result.resultState,'closed');
});
test('estimativa Full entra uma vez e deixa o resultado provisório',()=>{
 const result=calculateSale({...sale,operation:{channel:'full',source:'product'},fullExpense:{cents:1000,state:'estimated',month:'2026-09',unitRateCents:500}},[cost]);
 assert.equal(result.contributionCents,5000);assert.equal(result.resultState,'provisional');
});
test('primeiro mês Full sem referência continua pendente',()=>{
 const result=calculateSale({...sale,operation:{channel:'full',source:'product'}},[cost]);
 assert.equal(result.fullExpenseCents,null);assert.equal(result.contributionCents,null);assert.equal(result.resultState,'pending');assert.ok(result.reasons.some(reason=>reason.includes('Full')));
});
test('despesa Full manual positiva vale antes do fechamento',()=>{
 const result=calculateSale({...sale,reconciliation:{state:'manual',channel:'full',amounts:{revenueCents:20000,feeCents:3000,shippingCents:1000,otherCents:0,costCents:10000,taxCents:0,fullExpenseCents:750}}},[cost]);
 assert.equal(result.contributionCents,5250);assert.equal(result.resultState,'manual');
});
test('estimativa mensal não substitui despesa Full manual positiva',()=>{
 const result=calculateSale({...sale,reconciliation:{state:'manual',channel:'full',amounts:{revenueCents:20000,feeCents:3000,shippingCents:1000,otherCents:0,costCents:10000,taxCents:0,fullExpenseCents:750}},fullExpense:{cents:1000,state:'estimated',month:'2026-09',unitRateCents:500}},[cost]);
 assert.equal(result.fullExpenseCents,750);assert.equal(result.contributionCents,5250);assert.equal(result.resultState,'manual');
});
test('fechamento Full desatualizado impede contribuição',()=>{
 const result=calculateSale({...sale,operation:{channel:'full',source:'product'},fullClosureState:'stale'},[cost]);
 assert.equal(result.contributionCents,null);assert.equal(result.resultState,'stale');
});
test('venda comum completa permanece automática',()=>{
 const result=calculateSale({...sale,operation:{channel:'other',source:'meli'}},[cost]);
 assert.equal(result.contributionCents,6000);assert.equal(result.resultState,'automatic');
});
test('ficha do anúncio é a fonte primária mesmo quando existe custo legado',()=>{
 const tax:TaxRule={mode:'included'};
 const result=calculateSale({...sale,adProfile:{eventId:'p',revision:1,validFrom:'2026-09-01',unitCostTenThousandths:1_000_050,tax}},[{...cost,unitCost:1}]);
 assert.equal(result.costCents,20001);
 assert.equal(result.taxCents,0);
});
test('modalidade desconhecida impede margem até confirmar possível despesa Full',()=>{
 const result=calculateSale({...sale,operation:{channel:'unknown',source:'unknown'}},[cost]);
 assert.equal(result.contributionCents,null);assert.equal(result.fullExpenseCents,null);assert.ok(result.reasons.some(reason=>/Modalidade/.test(reason)));
});
test('correção obsoleta impede margem e deixa o resultado stale',()=>{
 const result=calculateSale({...sale,operation:{channel:'other',source:'meli'},correctionState:'stale'},[cost]);
 assert.equal(result.contributionCents,null);assert.equal(result.resultState,'stale');assert.ok(result.reasons.some(reason=>/correção/i.test(reason)));
});
