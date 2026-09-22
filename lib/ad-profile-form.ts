import type {AdProfilePayload,OperationOverride,TaxRule} from './ad-profiles.ts';
import {businessDate} from './dates.ts';
import {parseDecimal} from './imports.ts';

export type AdProfileFormValues={
 unitCost:string;
 taxMode:'included'|'unit'|'percent';
 taxValue:string;
 operation:OperationOverride;
 validFrom:string;
 reason:string;
};
export type ParsedAdProfileForm={payload:AdProfilePayload;validFrom:string;reason:string};
export type AdProfileFormResult={ok:true;value:ParsedAdProfileForm}|{ok:false;errors:Partial<Record<keyof AdProfileFormValues,string>>};

function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
function decimal(value:string,min:number,max:number){const parsed=parseDecimal(value);return parsed!==null&&parsed>=min&&parsed<=max?parsed:null;}

export function parseAdProfileForm(form:AdProfileFormValues):AdProfileFormResult{
 const errors:Partial<Record<keyof AdProfileFormValues,string>>={};
 const cost=decimal(form.unitCost,0,10_000_000);
 if(cost===null)errors.unitCost='Use um valor de 0 a 10.000.000 com até quatro casas decimais.';
 let tax:TaxRule={mode:'included'};
 if(form.taxMode==='unit'){
  const value=decimal(form.taxValue,0,10_000_000);
  if(value===null)errors.taxValue='Use um imposto unitário de 0 a 10.000.000 com até quatro casas decimais.';
  else tax={mode:'unit',valueTenThousandths:Math.round(value*10_000)};
 }else if(form.taxMode==='percent'){
  const value=decimal(form.taxValue,0,100);
  if(value===null)errors.taxValue='Use um percentual entre 0 e 100.';
  else tax={mode:'percent',rateBasisPoints:Math.round(value*100)};
 }
 if(!validDate(form.validFrom))errors.validFrom='Informe uma data válida.';
 const reason=form.reason.trim();if(reason.length<3||reason.length>240)errors.reason='Explique o motivo em 3 a 240 caracteres.';
 if(Object.keys(errors).length||cost===null)return {ok:false,errors};
 return {ok:true,value:{payload:{unitCostTenThousandths:Math.round(cost*10_000),tax,operation:form.operation},validFrom:form.validFrom,reason}};
}

export function formatTenThousandths(value:number){
 const whole=Math.floor(value/10_000),fraction=String(value%10_000).padStart(4,'0').replace(/0+$/,'');
 return fraction?`${whole},${fraction}`:String(whole);
}
export function formatBasisPoints(value:number){
 const whole=Math.floor(value/100),fraction=String(value%100).padStart(2,'0').replace(/0+$/,'');
 return fraction?`${whole},${fraction}`:String(whole);
}
export function isPastValidity(validFrom:string,today=businessDate(new Date())){return validDate(validFrom)&&validFrom<today;}
