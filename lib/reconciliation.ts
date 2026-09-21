import type {CostRecord,ReconciliationAmounts,Sale,SaleOperation,SalesChannel} from './finance.ts';

export type ProductLinkPayload={kind:'product';sku:string;channel?:SalesChannel};
export type SaleAdjustmentPayload={kind:'sale';channel:SalesChannel;amounts:ReconciliationAmounts};
export type ReconciliationPayload=ProductLinkPayload|SaleAdjustmentPayload;
export type ReconciliationEvent={
 id:string;accountId:string;targetType:'product'|'sale';targetKey:string;validFrom:string;revision:number;
 action:'set'|'clear';payload:ReconciliationPayload|null;sourceStamp:string|null;reason:string;createdAt:string;
};
export type ReconciliationEventRow=Omit<ReconciliationEvent,'payload'|'targetType'|'action'> & {targetType:string;action:string;payload:string|null};

export function reconciliationEventFromRow(row:ReconciliationEventRow):ReconciliationEvent|null{
 try{
  if(!['product','sale'].includes(row.targetType)||!['set','clear'].includes(row.action))return null;
  const payload=row.payload===null?null:JSON.parse(row.payload) as ReconciliationPayload;
  if(payload!==null&&payload.kind!=='product'&&payload.kind!=='sale')return null;
  return {...row,targetType:row.targetType as ReconciliationEvent['targetType'],action:row.action as ReconciliationEvent['action'],payload};
 }catch{return null;}
}
export function reconciliationEventsFromRows(rows:ReconciliationEventRow[]){return rows.map(reconciliationEventFromRow).filter((event):event is ReconciliationEvent=>event!==null);}

export function productTargetKey(itemId:string,variationId?:string|null){return JSON.stringify([itemId,variationId??null]);}
const commonLogistics=new Set(['drop_off','cross_docking','xd_drop_off','self_service','default','custom']);
export function resolveOperation(logisticType:string|null|undefined,manualChannel:SalesChannel='unknown',productChannel:SalesChannel='unknown'):SaleOperation{
 const official:SalesChannel=logisticType==='fulfillment'?'full':logisticType&&commonLogistics.has(logisticType)?'other':'unknown';
 if(official!=='unknown'){
  const conflict=[manualChannel,productChannel].some(channel=>channel!=='unknown'&&channel!==official)?'A modalidade configurada diverge do envio do Mercado Livre.':undefined;
  return {channel:official,source:'meli',...(conflict?{conflict}:{})};
 }
 if(manualChannel!=='unknown')return {channel:manualChannel,source:'manual'};
 if(productChannel!=='unknown')return {channel:productChannel,source:'product'};
 return {channel:'unknown',source:'unknown'};
}
export type ReconciliationStatus='stale'|'manual-pending'|'manual'|'pending'|'automatic';
export function reconciliationStatus(sale:{contributionCents:number|null;reconciliation?:Sale['reconciliation']}):ReconciliationStatus{
 if(sale.reconciliation?.state==='stale')return 'stale';
 if(sale.contributionCents===null)return sale.reconciliation?.state==='manual'?'manual-pending':'pending';
 return sale.reconciliation?.state==='manual'?'manual':'automatic';
}
export function initialReconciliationAmounts(sale:Sale,fallback:ReconciliationAmounts):ReconciliationAmounts{
 return sale.reconciliation?.amounts?{...sale.reconciliation.amounts}:{...fallback};
}

function currentCost(sale:Sale,costs:CostRecord[]){
 const sku=sale.costSku??sale.sku;
 return costs.filter(c=>c.accountId===sale.accountId&&c.sku===sku&&c.validFrom<=sale.date)
  .sort((a,b)=>b.validFrom.localeCompare(a.validFrom)||b.importedAt.localeCompare(a.importedAt)||b.id.localeCompare(a.id))[0]??null;
}

export function saleSourceStamp(sale:Sale,cost:CostRecord|null){
 return JSON.stringify({
  sale:{id:sale.id,orderId:sale.orderId,accountId:sale.accountId,sku:sale.sku,costSku:sale.costSku??null,itemId:sale.itemId??null,variationId:sale.variationId??null,logisticType:sale.logisticType??null,date:sale.date,quantity:sale.quantity,costQuantity:sale.costQuantity,grossSalesCents:sale.grossSalesCents??null,revenueCents:sale.revenueCents,feeCents:sale.feeCents,shippingCents:sale.shippingCents,otherCents:sale.otherCents,status:sale.status,sourceIssues:sale.sourceIssues??[]},
  cost:cost?{id:cost.id,sku:cost.sku,unitCost:cost.unitCost,taxValue:cost.taxValue,taxType:cost.taxType,taxTreatment:cost.taxTreatment,validFrom:cost.validFrom,importedAt:cost.importedAt}:null,
 });
}

function latestEvents(events:ReconciliationEvent[]){
 const latest=new Map<string,ReconciliationEvent>();
 for(const event of events){
  const key=[event.accountId,event.targetType,event.targetKey,event.validFrom].join('\0');
  const saved=latest.get(key);
  if(!saved||event.revision>saved.revision)latest.set(key,event);
 }
 return [...latest.values()];
}

function productLinks(events:ReconciliationEvent[],sale:Sale){
 if(!sale.itemId)return undefined;
 const target=productTargetKey(sale.itemId,sale.variationId);
 return latestEvents(events).filter(event=>event.accountId===sale.accountId&&event.targetType==='product'&&event.targetKey===target&&event.action==='set'&&event.payload?.kind==='product');
}
export function activeProductLink(events:ReconciliationEvent[],sale:Sale){return productLinks(events,sale)?.filter(event=>event.validFrom<=sale.date).sort((a,b)=>b.validFrom.localeCompare(a.validFrom)||b.revision-a.revision)[0];}
export function latestProductLink(events:ReconciliationEvent[],sale:Sale){return productLinks(events,sale)?.sort((a,b)=>b.validFrom.localeCompare(a.validFrom)||b.revision-a.revision)[0];}

export function applyReconciliation(sales:Sale[],costs:CostRecord[],events:ReconciliationEvent[]):Sale[]{
 const latest=latestEvents(events);
 return sales.map(original=>{
  const link=activeProductLink(latest,original);
  let sale:Sale={...original};
  if(link?.payload?.kind==='product')sale={...sale,costSku:link.payload.sku,linkRevision:link.revision,linkValidFrom:link.validFrom};
  const adjustment=latest.find(event=>event.accountId===original.accountId&&event.targetType==='sale'&&event.targetKey===original.id&&event.validFrom==='');
  const cost=currentCost(sale,costs);
  const stamp=saleSourceStamp(sale,cost);
  sale={...sale,sourceStamp:stamp,saleRevision:adjustment?.revision??0};
  if(adjustment?.action==='set'&&adjustment.payload?.kind==='sale'){
   const legacyStamp=sale.logisticType==null?(()=>{const source=JSON.parse(stamp) as {sale:Record<string,unknown>};delete source.sale.logisticType;return JSON.stringify(source)})():null;
   const validStamp=adjustment.sourceStamp===stamp||legacyStamp!==null&&adjustment.sourceStamp===legacyStamp;
   sale.reconciliation={state:validStamp?'manual':'stale',channel:adjustment.payload.channel,amounts:adjustment.payload.amounts};
  }
  const manualChannel=sale.reconciliation?.state==='manual'?sale.reconciliation.channel:'unknown';
  const productChannel=link?.payload?.kind==='product'?link.payload.channel??'unknown':'unknown';
  return {...sale,operation:resolveOperation(sale.logisticType,manualChannel,productChannel)};
 });
}
