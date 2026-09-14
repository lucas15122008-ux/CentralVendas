import type { CostRecord } from './finance.ts';
export type Mapping = { sku:number; description:number; cost:number; tax:number };
export type ImportOptions = { accountId:string; validFrom:string; taxType:'unit'|'percent'; taxTreatment:'included'|'additional'|'unknown' };
export type ImportIssue = { row:number; message:string };
export function parseDecimal(value:unknown):number|null {
  if(typeof value==='number')return Number.isFinite(value)?Math.round(value*10000)/10000:null;
  if(typeof value!=='string')return null;
  let s=value.trim().replace(/^R\$\s*/,'').replace(/\s*%$/,'').trim();
  if(!s)return null;
  if(s.includes(',')) {if(!/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,4})?$/.test(s))return null;s=s.replace(/\./g,'').replace(',','.');}
  else if(/^-?\d{1,3}(?:\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  else if(!/^-?\d+(?:\.\d{1,4})?$/.test(s))return null;
  const n=Number(s);return Number.isFinite(n)?Math.round(n*10000)/10000:null;
}
export function normalizeRows(rows:unknown[][],mapping:Mapping,options:ImportOptions):{records:Omit<CostRecord,'id'|'importId'|'importedAt'>[];issues:ImportIssue[]} {
  const records:Omit<CostRecord,'id'|'importId'|'importedAt'>[]=[];const issues:ImportIssue[]=[];const seen=new Set<string>();
  rows.forEach((row,index)=>{
    if(row.every(v=>v===null||v===undefined||String(v).trim()===''))return;
    const sku=String(row[mapping.sku]??'').trim();const unitCost=parseDecimal(row[mapping.cost]);
    const rawTax=mapping.tax<0?null:row[mapping.tax];const taxValue=parseDecimal(rawTax);
    let message='';
    if(!sku||sku.length>100)message='Código/SKU ausente ou com mais de 100 caracteres.';
    else if(seen.has(sku))message=`SKU ${sku} aparece mais de uma vez neste lote.`;
    else if(unitCost===null||unitCost<0||unitCost>10000000)message='Custo inválido. Use um valor de 0 a 10.000.000.';
    else if(rawTax!==null&&rawTax!==undefined&&String(rawTax).trim()!==''&&(taxValue===null||taxValue<0||taxValue>(options.taxType==='percent'?100:10000000)))message='Imposto inválido para o formato escolhido.';
    if(message){issues.push({row:index+1,message});return;}
    seen.add(sku);records.push({...options,sku,description:String(row[mapping.description]??'').trim().slice(0,300),unitCost:unitCost!,taxValue});
  });
  return {records,issues};
}
