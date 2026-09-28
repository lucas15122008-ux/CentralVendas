import type {Sale} from './finance.ts';
import {saleCorrectionSourceStamp,type CorrectableField,type SaleCorrectionEvent} from './sale-corrections.ts';

export type RefundBatchOptions={stockReturned:boolean;feeRefunded:boolean;reason:string};
export type RefundCorrection={accountId:string;saleId:string;field:CorrectableField;action:'set';mode:'fallback'|'override';value:number;sourceValue:number|null;sourceStamp:string;expectedRevision:number;reason:string};

function isManual(sale:Sale,field:CorrectableField){
 const source=sale.fieldSources?.[field];
 return source==='manual_fallback'||source==='manual_override';
}

export function refundBatchSales(sales:Sale[]){
 return sales.filter(sale=>sale.status==='refunded'&&(sale.revenueCents===null||sale.costQuantity===null));
}

export function refundBatchCorrections(sales:Sale[],corrections:SaleCorrectionEvent[],options:RefundBatchOptions):RefundCorrection[]{
 const latestRevision=(sale:Sale,field:CorrectableField)=>Math.max(0,...corrections.filter(event=>event.accountId===sale.accountId&&event.saleId===sale.id&&event.field===field).map(event=>event.revision));
 return refundBatchSales(sales).flatMap(sale=>{
  const targets:[CorrectableField,number][]=[
   ['revenueCents',0],
   ['costQuantity',options.stockReturned?0:sale.quantity],
   ...(options.feeRefunded?[['feeCents',0] as [CorrectableField,number]]:[]),
   ['shippingCents',0],
   ['otherCents',0],
  ];
  return targets.flatMap(([field,value])=>{
   if(isManual(sale,field))return [];
   const official=sale[field];
   // Fields the Mercado Livre did inform stay as they are, except a fee the seller confirmed was refunded.
   if(official!==null&&!(field==='feeCents'&&official!==0))return [];
   const mode=official===null?'fallback' as const:'override' as const;
   return [{accountId:sale.accountId,saleId:sale.id,field,action:'set' as const,mode,value,sourceValue:official,sourceStamp:saleCorrectionSourceStamp(sale,field,official),expectedRevision:latestRevision(sale,field),reason:options.reason}];
  });
 });
}
