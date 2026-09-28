import type {FinancialField,Sale} from './finance.ts';

export const refundIssue='Cancelamento ou reembolso: receita e recuperação do estoque a conciliar.';

export type CorrectableField='revenueCents'|'feeCents'|'shippingCents'|'otherCents'|'costQuantity';

export type SaleCorrectionEvent={
 id:string;
 accountId:string;
 saleId:string;
 field:CorrectableField;
 revision:number;
 action:'set'|'clear';
 mode:'fallback'|'override';
 value:number|null;
 sourceValue:number|null;
 sourceStamp:string;
 requestId:string;
 reason:string;
 createdAt:string;
};

function currentValue(sale:Sale,field:CorrectableField){
 return sale[field];
}

export function saleCorrectionSourceStamp(sale:Sale,field:CorrectableField,value=currentValue(sale,field)){
 return JSON.stringify({version:1,accountId:sale.accountId,saleId:sale.id,field,value});
}

function withValue(sale:Sale,field:CorrectableField,value:number,source:'manual_fallback'|'manual_override'):Sale{
 return {
  ...sale,
  [field]:value,
  fieldSources:{...sale.fieldSources,[field satisfies FinancialField]:source},
 };
}

export function applySaleCorrections(sale:Sale,events:SaleCorrectionEvent[]):Sale{
 const latestByField=new Map<CorrectableField,SaleCorrectionEvent>();
 for(const event of events){
  if(event.accountId!==sale.accountId||event.saleId!==sale.id)continue;
  const saved=latestByField.get(event.field);
  if(!saved||event.revision>saved.revision)latestByField.set(event.field,event);
 }

 let result:Sale={...sale,fieldSources:sale.fieldSources?{...sale.fieldSources}:undefined,correctionState:undefined};
 for(const event of latestByField.values()){
  if(event.action==='clear'||event.value===null)continue;
  const officialValue=currentValue(sale,event.field);
  if(event.mode==='fallback'){
   if(officialValue===null){
    result=withValue(result,event.field,event.value,'manual_fallback');
    result.correctionState='corrected';
   }
   continue;
  }
  if(officialValue!==event.sourceValue||saleCorrectionSourceStamp(sale,event.field)!==event.sourceStamp){
   result.correctionState='stale';
   continue;
  }
  result=withValue(result,event.field,event.value,'manual_override');
  if(result.correctionState!=='stale')result.correctionState='corrected';
 }
 // Once revenue and stock recovery are informed, the refund no longer needs reconciliation.
 if(result.revenueCents!==null&&result.costQuantity!==null&&result.sourceIssues?.includes(refundIssue))result.sourceIssues=result.sourceIssues.filter(issue=>issue!==refundIssue);
 return result;
}
