import type {CorrectableField} from './sale-corrections.ts';

export type CorrectionValueResult={ok:true;value:number}|{ok:false;message:string};

function parseMoney(value:string):number|null{
 const compact=value.trim().replace(/\s/g,'');
 if(!compact)return null;
 const comma=/^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$|^\d+(?:,\d{1,2})?$/;
 const dot=/^\d+(?:\.\d{1,2})?$/;
 if(compact.includes(',')?!comma.test(compact):!dot.test(compact))return null;
 const parsed=Number(compact.includes(',')?compact.replace(/\./g,'').replace(',','.'):compact);
 if(!Number.isFinite(parsed)||parsed<0||parsed>10_000_000_000)return null;
 return Math.round(parsed*100);
}

export function parseCorrectionValue(field:CorrectableField,value:string):CorrectionValueResult{
 if(field==='costQuantity'){
  const compact=value.trim();
  if(!/^\d+$/.test(compact))return {ok:false,message:'Informe uma quantidade inteira igual ou maior que zero.'};
  const parsed=Number(compact);
  return Number.isSafeInteger(parsed)&&parsed<=1_000_000?{ok:true,value:parsed}:{ok:false,message:'Informe uma quantidade válida.'};
 }
 const cents=parseMoney(value);
 return cents===null?{ok:false,message:'Use um valor positivo em reais, como 150,00.'}:{ok:true,value:cents};
}

export function correctionMode(sourceValue:number|null){return sourceValue===null?'fallback' as const:'override' as const;}

export function formatCorrectionValue(field:CorrectableField,value:number|null){
 if(value===null)return 'Não informado';
 if(field==='costQuantity')return String(value);
 return new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100);
}
