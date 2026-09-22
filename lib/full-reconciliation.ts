import {allocateCents} from './allocation.ts';
import {calculateSale,type CostRecord,type Sale} from './finance.ts';
import {parseDecimal} from './imports.ts';

export type FullAllocation={saleId:string;units:number;expenseCents:number};
export type FullClosure={id:string;accountId:string;month:string;revision:number;action:'set'|'clear';totalExpenseCents:number|null;eligibleUnits:number;sourceStamp:string|null;reason:string;createdAt:string;stale?:boolean;allocations:FullAllocation[]};
export type FullPreview={eligible:Sale[];excluded:{saleId:string;reason:string}[];conflicts:string[];units:number};

function saleMonth(date:string){return date.slice(0,7);}
function positiveInteger(value:number|null):value is number{return Number.isSafeInteger(value)&&value!==null&&value>0;}
export function estimateFullExpenseCents(totalExpenseCents:number,eligibleUnits:number,saleUnits:number){return Math.round(totalExpenseCents/eligibleUnits*saleUnits);}
export function selectedFullPreview<T extends {accountId:string;month:string}>(data:T|null,accountId:string,month:string):T|null{return data?.accountId===accountId&&data.month===month?data:null;}

export function previewFullMonth(sales:Sale[],_costs:CostRecord[],accountId:string,month:string):FullPreview{
 const eligible:Sale[]=[];
 const excluded:FullPreview['excluded']=[];
 const conflicts:string[]=[];
 for(const sale of sales){
  if(sale.accountId!==accountId||saleMonth(sale.date)!==month)continue;
  if(sale.status!=='paid'){excluded.push({saleId:sale.id,reason:'Venda não está paga.'});continue;}
  if(sale.operation?.channel!=='full'){excluded.push({saleId:sale.id,reason:'Venda não classificada como Full.'});continue;}
  if(!positiveInteger(sale.costQuantity)){excluded.push({saleId:sale.id,reason:'Quantidade consumida não confirmada.'});continue;}
  eligible.push(sale);
  if(sale.reconciliation?.state==='manual'&&(sale.reconciliation.amounts?.fullExpenseCents??0)>0){
   conflicts.push(`A venda ${sale.orderId} possui despesa Full individual.`);
  }
 }
 eligible.sort((a,b)=>a.id.localeCompare(b.id));
 excluded.sort((a,b)=>a.saleId.localeCompare(b.saleId));
 return {eligible,excluded,conflicts,units:eligible.reduce((sum,sale)=>sum+sale.costQuantity!,0)};
}

export function fullMonthSource(preview:FullPreview,costs:CostRecord[]):string{
 const sales=preview.eligible.map(sale=>{
  const selectedCost=calculateSale(sale,costs).cost;
  const manualAmounts=sale.reconciliation?.state==='manual'?sale.reconciliation.amounts??null:null;
  const correctedFields=(['revenueCents','feeCents','shippingCents','otherCents','costQuantity'] as const).flatMap(field=>{
   const source=sale.fieldSources?.[field];
   return source==='manual_fallback'||source==='manual_override'?[{field,value:sale[field],source}]:[];
  });
  return {id:sale.id,date:sale.date,units:sale.costQuantity,operation:{channel:sale.operation?.channel??'unknown',source:sale.operation?.source??'unknown',logisticType:sale.logisticType??null},sourceStamp:sale.sourceStamp??null,costId:selectedCost?.id??null,adProfile:sale.adProfile??null,correctedFields,correctionState:sale.correctionState??null,manualAmounts};
 });
 return JSON.stringify({sales});
}

export function allocateFullMonth(totalExpenseCents:number,preview:FullPreview):FullAllocation[]{
 if(!Number.isSafeInteger(totalExpenseCents)||totalExpenseCents<0)throw new Error('O total Full deve ser um valor seguro em centavos.');
 if(preview.conflicts.length)throw new Error('Remova a despesa Full individual do ajuste manual antes de fechar o mês.');
 if(!positiveInteger(preview.units))throw new Error('Não há unidades Full elegíveis para este mês.');
 const cents=allocateCents(totalExpenseCents,preview.eligible.map(sale=>sale.costQuantity!));
 return preview.eligible.map((sale,index)=>({saleId:sale.id,units:sale.costQuantity!,expenseCents:cents[index]}));
}

function latestClosures(closures:FullClosure[]){
 const latest=new Map<string,FullClosure>();
 for(const closure of closures){
  const key=`${closure.accountId}\0${closure.month}`;
  const saved=latest.get(key);
  if(!saved||closure.revision>saved.revision||(closure.revision===saved.revision&&(closure.createdAt>saved.createdAt||(closure.createdAt===saved.createdAt&&closure.id>saved.id))))latest.set(key,closure);
 }
 return latest;
}

export function applyFullClosures(sales:Sale[],closures:FullClosure[]):Sale[]{
 const latest=latestClosures(closures);
 const usable=[...latest.values()].filter(closure=>closure.action==='set'&&!closure.stale&&closure.totalExpenseCents!==null&&positiveInteger(closure.eligibleUnits));
 return sales.map(original=>{
  const sale:Sale={...original};
  delete sale.fullExpense;
  delete sale.fullClosureState;
  const month=saleMonth(sale.date);
  const current=latest.get(`${sale.accountId}\0${month}`);
  if(current?.action==='set'&&current.stale){
   const affected=current.allocations.some(row=>row.saleId===sale.id)||sale.operation?.channel==='full';
   if(affected)sale.fullClosureState='stale';
   return sale;
  }
  if(current?.action==='set'){
   const allocation=current.allocations.find(row=>row.saleId===sale.id);
   if(allocation&&current.totalExpenseCents!==null&&positiveInteger(current.eligibleUnits)){
    sale.fullExpense={cents:allocation.expenseCents,state:'closed',month,closureId:current.id,unitRateCents:Math.round(current.totalExpenseCents/current.eligibleUnits)};
    return sale;
   }
  }
  if(sale.status!=='paid'||sale.operation?.channel!=='full'||!positiveInteger(sale.costQuantity))return sale;
  if(sale.reconciliation?.state==='manual'&&(sale.reconciliation.amounts?.fullExpenseCents??0)>0)return sale;
  const previous=usable.filter(closure=>closure.accountId===sale.accountId&&closure.month<month).sort((a,b)=>b.month.localeCompare(a.month))[0];
  if(!previous||previous.totalExpenseCents===null)return sale;
  const unitRate=previous.totalExpenseCents/previous.eligibleUnits;
  sale.fullExpense={cents:estimateFullExpenseCents(previous.totalExpenseCents,previous.eligibleUnits,sale.costQuantity),state:'estimated',month,unitRateCents:Math.round(unitRate)};
  return sale;
 });
}

export function parseBrlCents(input:string):number|null{
 const raw=input.trim().replace(/^R\$\s*/,'').trim();
 if(!raw||raw.startsWith('-'))return null;
 const decimalPart=raw.includes(',')?raw.split(',').at(-1):/^\d+\.\d{1,2}$/.test(raw)?raw.split('.').at(-1):undefined;
 if(decimalPart!==undefined&&decimalPart.length>2)return null;
 const value=parseDecimal(input);
 if(value===null||value<0)return null;
 const cents=Math.round(value*100);
 if(!Number.isSafeInteger(cents)||Math.abs(value*100-cents)>1e-8)return null;
 return cents;
}
