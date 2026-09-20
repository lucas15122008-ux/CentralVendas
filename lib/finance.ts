export type CostRecord = { id:string; accountId:string; sku:string; description:string; unitCost:number; taxValue:number|null; taxType:'unit'|'percent'; taxTreatment:'included'|'additional'|'unknown'; validFrom:string; importedAt:string; importId:string };
export type ReconciliationAmounts = {revenueCents:number|null;feeCents:number|null;shippingCents:number|null;otherCents:number|null;costCents:number|null;taxCents:number|null;fullExpenseCents:number|null};
export type SalesChannel='full'|'other'|'unknown';
export type SaleOperation={channel:SalesChannel;source:'meli'|'manual'|'product'|'unknown';conflict?:string};
export type Sale = { id:string; orderId:string; accountId:string; sku:string; title:string; date:string; quantity:number; costQuantity:number|null; grossSalesCents?:number|null; revenueCents:number|null; feeCents:number|null; shippingCents:number|null; otherCents:number|null; status:'paid'|'cancelled'|'refunded'|'pending'; source?:'mercadolivre'; sourceIssues?:string[]; itemId?:string; variationId?:string|null;logisticType?:string|null;operation?:SaleOperation;costSku?:string;reconciliation?:{state:'manual'|'stale';channel:SalesChannel;amounts?:ReconciliationAmounts};sourceStamp?:string;saleRevision?:number;linkRevision?:number;linkValidFrom?:string;fullExpense?:{cents:number;state:'estimated'|'closed';month:string;closureId?:string;unitRateCents:number};fullClosureState?:'stale' };
export type ResultState='pending'|'provisional'|'automatic'|'closed'|'manual'|'stale';
export type SaleResult = Sale & { cost:CostRecord|null; costCents:number|null; taxCents:number|null; fullExpenseCents:number|null; contributionCents:number|null; margin:number|null; reasons:string[];resultState:ResultState };
function resultState(sale:Sale,reasons:string[]):ResultState{
 if(sale.reconciliation?.state==='stale'||sale.fullClosureState==='stale')return 'stale';
 if(reasons.length)return 'pending';
 if(sale.fullExpense?.state==='estimated')return 'provisional';
 if(sale.fullExpense?.state==='closed')return 'closed';
 if(sale.reconciliation?.state==='manual')return 'manual';
 return 'automatic';
}
export function calculateSale(sale:Sale,costs:CostRecord[]):SaleResult {
  const cost=costs.filter(c=>c.accountId===sale.accountId&&c.sku===(sale.costSku??sale.sku)&&c.validFrom<=sale.date).sort((a,b)=>b.validFrom.localeCompare(a.validFrom)||b.importedAt.localeCompare(a.importedAt)||b.id.localeCompare(a.id))[0]??null;
  const projectedFull=sale.fullExpense?.cents;
  if(sale.reconciliation?.state==='manual'&&sale.reconciliation.amounts){
    const a=sale.reconciliation.amounts;
    const fullExpenseCents=projectedFull??a.fullExpenseCents;
    const effective={...a,fullExpenseCents};
    const labels:Record<keyof ReconciliationAmounts,string>={revenueCents:'Receita líquida',feeCents:'Tarifa',shippingCents:'Frete',otherCents:'Outras despesas',costCents:'Custo consumido',taxCents:'Imposto adicional',fullExpenseCents:'Despesa adicional Full'};
    const reasons=Object.entries(labels).filter(([key])=>effective[key as keyof ReconciliationAmounts]===null).map(([,label])=>label+' não confirmado');
    if(sale.fullClosureState==='stale')reasons.push('O fechamento Full mudou: revise o mês');
    const contributionCents=reasons.length?null:effective.revenueCents!-effective.feeCents!-effective.shippingCents!-effective.otherCents!-effective.costCents!-effective.taxCents!-effective.fullExpenseCents!;
    return {...sale,...effective,cost,contributionCents,margin:contributionCents!==null&&effective.revenueCents!>0?contributionCents/effective.revenueCents!*100:null,reasons,resultState:resultState(sale,reasons)};
  }
  const reasons:string[]=[...(sale.sourceIssues??[])];
  if(sale.reconciliation?.state==='stale')reasons.push('A venda ou seu custo mudou: revise o ajuste manual');
  if(sale.fullClosureState==='stale')reasons.push('O fechamento Full mudou: revise o mês');
  if(sale.revenueCents===null)reasons.push('Receita líquida a conciliar');
  if(sale.feeCents===null)reasons.push('Tarifa não confirmada');
  if(sale.shippingCents===null)reasons.push('Frete do vendedor não confirmado');
  if(sale.otherCents===null)reasons.push('Despesas variáveis não confirmadas');
  if(sale.costQuantity===null)reasons.push('Recuperação de estoque a conferir');
  if(!cost)reasons.push('Custo sem vigência para esta venda');
  if(cost?.taxTreatment==='unknown')reasons.push('Composição do imposto a conferir');
  if(cost&&cost.taxValue===null)reasons.push('Imposto não informado');
  const costCents=cost&&sale.costQuantity!==null?Math.round(Math.round(cost.unitCost*10000)*sale.costQuantity/100):null;
  const taxCents=cost&&cost.taxValue!==null?(cost.taxTreatment==='additional'?(cost.taxType==='percent'?(sale.revenueCents===null?null:Math.round(sale.revenueCents*cost.taxValue/100)):(sale.costQuantity===null?null:Math.round(Math.round(cost.taxValue*10000)*sale.costQuantity/100))):0):null;
  const fullExpenseCents=projectedFull??(sale.operation?.channel==='full'?null:0);
  if(fullExpenseCents===null)reasons.push('Despesa Full ainda sem estimativa');
  const contributionCents=reasons.length?null:(sale.revenueCents??0)-(sale.feeCents??0)-(sale.shippingCents??0)-(sale.otherCents??0)-(costCents??0)-(taxCents??0)-fullExpenseCents!;
  return {...sale,cost,costCents,taxCents,fullExpenseCents,contributionCents,margin:contributionCents!==null&&sale.revenueCents!==null&&sale.revenueCents>0?contributionCents/sale.revenueCents*100:null,reasons,resultState:resultState(sale,reasons)};
}
export function saleBreakdownRows(sale:SaleResult){
 const rows=[{label:'Receita dos itens',value:sale.revenueCents},{label:'Tarifas',value:sale.feeCents===null?null:-sale.feeCents},{label:'Frete do vendedor',value:sale.shippingCents===null?null:-sale.shippingCents},{label:'Custo dos produtos',value:sale.costCents===null?null:-sale.costCents},{label:'Imposto adicional',value:sale.taxCents===null?null:-sale.taxCents},{label:'Outras despesas variáveis',value:sale.otherCents===null?null:-sale.otherCents}];
 const showFull=sale.operation?.channel==='full'||sale.reconciliation?.channel==='full'||sale.fullExpense!==undefined||(sale.fullExpenseCents??0)>0;
 if(showFull){const label=sale.fullExpense?.state==='estimated'?'Despesa Full estimada':sale.fullExpense?.state==='closed'?'Despesa Full fechada':'Despesa adicional Full';rows.push({label,value:sale.fullExpenseCents===null?null:-sale.fullExpenseCents});}
 return rows;
}
export function summarizeSales(sales:Sale[],costs:CostRecord[]) {
  const rows=sales.filter(s=>s.status!=='cancelled'&&s.status!=='pending').map(s=>calculateSale(s,costs));
  const gross=(row:Sale)=>row.status==='paid'?(row.grossSalesCents??row.revenueCents):null;
  const grossSalesCents=rows.reduce((sum,row)=>sum+(gross(row)??0),0);
  const revenueCents=rows.reduce((s,r)=>s+(r.revenueCents??0),0);
  const covered=rows.filter(r=>r.contributionCents!==null);
  const coveredGrossSalesCents=covered.reduce((sum,row)=>sum+(gross(row)??0),0);
  const coveredRevenueCents=covered.reduce((s,r)=>s+(r.revenueCents??0),0);
  const contributionCents=covered.reduce((s,r)=>s+(r.contributionCents??0),0);
  return {unknownRevenue:rows.filter(r=>r.revenueCents===null).length,unknownGrossSales:rows.filter(r=>r.status==='paid'&&gross(r)===null).length,grossSalesCents,revenueCents,contributionCents,coveredRevenueCents,coveredGrossSalesCents,coverage:grossSalesCents>0?coveredGrossSalesCents/grossSalesCents*100:0,margin:coveredRevenueCents>0?contributionCents/coveredRevenueCents*100:null,orders:new Set(rows.map(s=>s.accountId+'\0'+s.orderId)).size,paidOrders:new Set(rows.filter(s=>s.status==='paid').map(s=>s.accountId+'\0'+s.orderId)).size,rows};
}
export function groupProducts(rows:SaleResult[]){
 const products=new Map<string,{sku:string;account:string;title:string;units:number;revenue:number;profit:number;complete:boolean}>();
 for(const row of rows){
  const key=row.accountId+'\0'+row.sku;
  const product=products.get(key)??{sku:row.sku,account:row.accountId,title:row.title,units:0,revenue:0,profit:0,complete:true};
  product.units+=row.quantity;product.revenue+=row.revenueCents??0;product.profit+=row.contributionCents??0;product.complete&&=row.contributionCents!==null;
  products.set(key,product);
 }
 return [...products.values()];
}
export const money=(cents:number|null)=>cents===null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
export const percent=(value:number|null)=>value===null?'—':`${value.toLocaleString('pt-BR',{maximumFractionDigits:1})}%`;
