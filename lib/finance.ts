export type CostRecord = { id:string; accountId:string; sku:string; description:string; unitCost:number; taxValue:number|null; taxType:'unit'|'percent'; taxTreatment:'included'|'additional'|'unknown'; validFrom:string; importedAt:string; importId:string };
export type Sale = { id:string; orderId:string; accountId:string; sku:string; title:string; date:string; quantity:number; costQuantity:number; revenueCents:number; feeCents:number; shippingCents:number; otherCents:number; status:'paid'|'cancelled'|'refunded' };
export type SaleResult = Sale & { cost:CostRecord|null; costCents:number|null; taxCents:number|null; contributionCents:number|null; margin:number|null; reasons:string[] };
export function calculateSale(sale:Sale,costs:CostRecord[]):SaleResult {
  const cost=costs.filter(c=>c.accountId===sale.accountId&&c.sku===sale.sku&&c.validFrom<=sale.date).sort((a,b)=>b.validFrom.localeCompare(a.validFrom)||b.importedAt.localeCompare(a.importedAt))[0]??null;
  const reasons:string[]=[];
  if(!cost)reasons.push('Custo sem vigência para esta venda');
  if(cost?.taxTreatment==='unknown')reasons.push('Composição do imposto a conferir');
  if(cost&&cost.taxValue===null)reasons.push('Imposto não informado');
  const costCents=cost?Math.round(Math.round(cost.unitCost*10000)*sale.costQuantity/100):null;
  const taxCents=cost&&cost.taxValue!==null?(cost.taxTreatment==='additional'?(cost.taxType==='percent'?Math.round(sale.revenueCents*cost.taxValue/100):Math.round(Math.round(cost.taxValue*10000)*sale.costQuantity/100)):0):null;
  const contributionCents=reasons.length?null:sale.revenueCents-sale.feeCents-sale.shippingCents-sale.otherCents-(costCents??0)-(taxCents??0);
  return {...sale,cost,costCents,taxCents,contributionCents,margin:contributionCents!==null&&sale.revenueCents>0?contributionCents/sale.revenueCents*100:null,reasons};
}
export function summarizeSales(sales:Sale[],costs:CostRecord[]) {
  const rows=sales.filter(s=>s.status!=='cancelled').map(s=>calculateSale(s,costs));
  const revenueCents=rows.reduce((s,r)=>s+r.revenueCents,0);
  const covered=rows.filter(r=>r.contributionCents!==null);
  const coveredRevenueCents=covered.reduce((s,r)=>s+r.revenueCents,0);
  const contributionCents=covered.reduce((s,r)=>s+(r.contributionCents??0),0);
  return {revenueCents,contributionCents,coveredRevenueCents,coverage:revenueCents>0?coveredRevenueCents/revenueCents*100:0,margin:coveredRevenueCents>0?contributionCents/coveredRevenueCents*100:null,orders:new Set(rows.map(s=>s.accountId+'\0'+s.orderId)).size,rows};
}
export function groupProducts(rows:SaleResult[]){
 const products=new Map<string,{sku:string;account:string;title:string;units:number;revenue:number;profit:number;complete:boolean}>();
 for(const row of rows){
  const key=row.accountId+'\0'+row.sku;
  const product=products.get(key)??{sku:row.sku,account:row.accountId,title:row.title,units:0,revenue:0,profit:0,complete:true};
  product.units+=row.quantity;product.revenue+=row.revenueCents;product.profit+=row.contributionCents??0;product.complete&&=row.contributionCents!==null;
  products.set(key,product);
 }
 return [...products.values()];
}
export const money=(cents:number|null)=>cents===null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
export const percent=(value:number|null)=>value===null?'—':`${value.toLocaleString('pt-BR',{maximumFractionDigits:1})}%`;
