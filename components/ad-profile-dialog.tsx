'use client';
import {useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Choice} from './commerce-controls';
import {toast} from 'sonner';
import {Copy,History,LoaderCircle,Save,TriangleAlert,Trash2,WalletCards} from 'lucide-react';
import type {Account} from '@/lib/demo';
import type {MeliListing} from '@/lib/meli/catalog';
import type {AdProfileEvent} from '@/lib/ad-profiles';
import {adTargetKey,latestAdProfile} from '@/lib/ad-profiles';
import type {Sale} from '@/lib/finance';
import {calculateSale,money,percent} from '@/lib/finance';
import {applyAdProfiles} from '@/lib/sale-projection';
import {businessDate} from '@/lib/dates';
import {formatBasisPoints,formatTenThousandths,isPastValidity,parseAdProfileForm,type AdProfileFormValues} from '@/lib/ad-profile-form';

function targetMatches(profile:AdProfileEvent,listing:MeliListing){return profile.accountId===listing.accountId&&profile.itemId===listing.itemId&&profile.variationId===listing.variationId;}
function initialValues(profile:AdProfileEvent|undefined):AdProfileFormValues{
 const tax=profile?.payload?.tax;
 return {unitCost:profile?.payload?formatTenThousandths(profile.payload.unitCostTenThousandths):'',taxMode:tax?.mode??'included',taxValue:tax?.mode==='unit'?formatTenThousandths(tax.valueTenThousandths):tax?.mode==='percent'?formatBasisPoints(tax.rateBasisPoints):'',operation:profile?.payload?.operation??'auto',validFrom:profile?.validFrom??businessDate(new Date()),reason:''};
}
function variationLabel(listing:MeliListing){return listing.variationId?`Variação ${listing.variationId}`:'Sem variação';}

export function AdProfileDialog({listing,listings,profiles,sales,account,demo,onReload,onClose}:{listing:MeliListing;listings:MeliListing[];profiles:AdProfileEvent[];sales:Sale[];account?:Account;demo:boolean;onReload:()=>Promise<void>;onClose:()=>void}){
 const current=latestAdProfile(profiles,listing.accountId,listing.itemId,listing.variationId);
 const [form,setForm]=useState<AdProfileFormValues>(()=>initialValues(current));const [copySource,setCopySource]=useState('none');const [busy,setBusy]=useState<'save'|'clear'|null>(null);const [error,setError]=useState('');
 const history=useMemo(()=>profiles.filter(profile=>targetMatches(profile,listing)).sort((a,b)=>b.validFrom.localeCompare(a.validFrom)||b.revision-a.revision||b.createdAt.localeCompare(a.createdAt)),[profiles,listing]);
 const sourceOptions=useMemo(()=>listings.filter(item=>item.accountId===listing.accountId&&adTargetKey(item.itemId,item.variationId)!==adTargetKey(listing.itemId,listing.variationId)).flatMap(item=>{
  const profile=latestAdProfile(profiles,item.accountId,item.itemId,item.variationId);return profile?.payload?[{item,profile,key:adTargetKey(item.itemId,item.variationId)}]:[];
 }).sort((a,b)=>a.item.title.localeCompare(b.item.title)),[listings,profiles,listing]);
 const parsed=useMemo(()=>parseAdProfileForm(form),[form]);
 const latestSale=useMemo(()=>sales.filter(sale=>sale.accountId===listing.accountId&&sale.itemId===listing.itemId&&(sale.variationId??null)===listing.variationId).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id))[0],[sales,listing]);
 const preview=useMemo(()=>{
  if(!latestSale||!parsed.ok)return null;
  const temporary:AdProfileEvent={id:'preview',accountId:listing.accountId,itemId:listing.itemId,variationId:listing.variationId,validFrom:parsed.value.validFrom,revision:1,action:'set',payload:parsed.value.payload,requestId:'preview',reason:parsed.value.reason,origin:'native',createdAt:new Date().toISOString()};
  return calculateSale(applyAdProfiles([{...latestSale,financialMode:'native'}],[temporary])[0],[]);
 },[latestSale,parsed,listing]);
 const exactRevision=Math.max(0,...profiles.filter(profile=>targetMatches(profile,listing)&&profile.validFrom===form.validFrom).map(profile=>profile.revision));
 function change<K extends keyof AdProfileFormValues>(key:K,value:AdProfileFormValues[K],breakCopy=false){setForm(current=>({...current,[key]:value}));if(breakCopy)setCopySource('none');}
 function copy(value:string){setCopySource(value);if(value==='none')return;const source=sourceOptions.find(item=>item.key===value);if(!source?.profile.payload)return;const tax=source.profile.payload.tax;setForm(current=>({...current,unitCost:formatTenThousandths(source.profile.payload!.unitCostTenThousandths),taxMode:tax.mode,taxValue:tax.mode==='unit'?formatTenThousandths(tax.valueTenThousandths):tax.mode==='percent'?formatBasisPoints(tax.rateBasisPoints):''}));}
 async function submit(action:'set'|'clear'){
  const validation=parseAdProfileForm(form);if(!validation.ok){setError(Object.values(validation.errors)[0]??'Revise os campos.');return;}
  setBusy(action==='set'?'save':'clear');setError('');try{
   const source=sourceOptions.find(item=>item.key===copySource);
   const body=action==='set'?{action,requestId:crypto.randomUUID(),accountId:listing.accountId,itemId:listing.itemId,variationId:listing.variationId,validFrom:validation.value.validFrom,expectedRevision:exactRevision,payload:validation.value.payload,reason:validation.value.reason,...(source?{copyFrom:{accountId:source.item.accountId,itemId:source.item.itemId,variationId:source.item.variationId}}:{})}:{action,requestId:crypto.randomUUID(),accountId:listing.accountId,itemId:listing.itemId,variationId:listing.variationId,validFrom:validation.value.validFrom,expectedRevision:exactRevision,reason:validation.value.reason};
   const response=await fetch('/api/ad-profiles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json() as {error?:string};if(!response.ok)throw Error(result.error);
   await onReload();toast.success(action==='set'?'Ficha salva. As próximas vendas usarão esta vigência.':'Ficha removida nesta vigência.');onClose();
  }catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível salvar a ficha.')}finally{setBusy(null)}
 }
 return <DialogContent className="ad-profile-dialog"><DialogHeader><DialogTitle>Ficha financeira do anúncio</DialogTitle><DialogDescription>{listing.title} · {variationLabel(listing)} · {account?.name??'Conta'}</DialogDescription></DialogHeader>
  <div className="ad-profile-dialog-body">
   <section className="ad-profile-section"><div className="section-title"><Copy size={17}/><div><h3>Reaproveitar uma ficha</h3><p>Copia somente custo e imposto de outro anúncio desta conta. Operação, vigência e destino não mudam.</p></div></div><Choice label="Copiar de outro anúncio" value={copySource} onChange={copy} options={[{value:'none',label:'Não copiar'},...sourceOptions.map(({item,key})=>({value:key,label:`${item.title} · ${variationLabel(item)}`}))]}/>{copySource!=='none'&&<p className="info-box">Prévia copiada. Revise os dados abaixo e clique em Salvar para criar a nova revisão.</p>}</section>
   <section className="ad-profile-section"><div className="section-title"><WalletCards size={17}/><div><h3>Custo e imposto</h3><p>Valores unitários. O sistema multiplica pela quantidade consumida em cada venda.</p></div></div><div className="form-grid"><label>Custo unitário<Input inputMode="decimal" value={form.unitCost} placeholder="0,0000" onChange={event=>change('unitCost',event.target.value,true)}/><small>Até quatro casas decimais.</small></label><label>Como o imposto entra no custo<Choice label="Modo do imposto" value={form.taxMode} onChange={value=>change('taxMode',value as AdProfileFormValues['taxMode'],true)} options={[{value:'included',label:'Já incluído no custo'},{value:'unit',label:'Valor por unidade'},{value:'percent',label:'Percentual da receita'}]}/></label>{form.taxMode!=='included'&&<label>{form.taxMode==='unit'?'Imposto por unidade':'Percentual'}<Input inputMode="decimal" value={form.taxValue} placeholder={form.taxMode==='unit'?'0,0000':'0,00'} onChange={event=>change('taxValue',event.target.value,true)}/><small>{form.taxMode==='unit'?'Até quatro casas decimais.':'De 0% a 100%.'}</small></label>}<label>Operação<Choice label="Operação" value={form.operation} onChange={value=>change('operation',value as AdProfileFormValues['operation'])} options={[{value:'auto',label:'Detectar pelo Mercado Livre'},{value:'full',label:'Mercado Livre Full'},{value:'other',label:'Venda comum'}]}/></label></div></section>
   <section className="ad-profile-section"><div className="form-grid"><label>Válido a partir de<Input type="date" value={form.validFrom} onChange={event=>change('validFrom',event.target.value)}/></label><label>Motivo da alteração<Input value={form.reason} maxLength={240} placeholder="Ex.: custo atualizado no ERP" onChange={event=>change('reason',event.target.value)}/></label></div>{isPastValidity(form.validFrom)&&<div className="warning-box"><TriangleAlert size={17}/><p>Esta vigência alcança vendas passadas. Use-a somente se o valor realmente valia desde essa data.</p></div>}</section>
   <section className="ad-profile-preview"><div><span>Prévia na última venda</span><strong>{latestSale?`Pedido #${latestSale.orderId}`:'Nenhuma venda deste anúncio'}</strong></div>{preview?<div className="preview-metrics"><div><span>Custo</span><strong>{money(preview.costCents)}</strong></div><div><span>Imposto</span><strong>{money(preview.taxCents)}</strong></div><div><span>Contribuição</span><strong>{money(preview.contributionCents)}</strong></div><div><span>Margem</span><strong>{percent(preview.margin)}</strong></div></div>:latestSale&&<p className="note-text">Preencha dados válidos e escolha uma vigência que alcance a última venda para visualizar o cálculo.</p>}</section>
   {history.length>0&&<section className="ad-profile-history"><div className="section-title"><History size={17}/><div><h3>Histórico da ficha</h3><p>Cada salvamento cria uma revisão auditável.</p></div></div>{history.map(event=><div className="ad-history-row" key={event.id}><div><strong>{event.origin==='legacy'?'Dados anteriores':'Cadastro'} · revisão {event.revision}</strong><span>Vigência {event.validFrom.split('-').reverse().join('/')}</span></div><div><span>{event.action==='clear'?'Removida':event.reason}</span><small>{new Date(event.createdAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</small></div></div>)}</section>}
   {demo&&<p className="info-box">Na demonstração, você pode testar os campos e a prévia. Para salvar, use Minha operação.</p>}{error&&<p className="error-box" role="alert">{error}</p>}
  </div><div className="dialog-actions"><div>{exactRevision>0&&<Button variant="ghost" disabled={demo||!!busy||form.reason.trim().length<3} onClick={()=>void submit('clear')}>{busy==='clear'?<LoaderCircle className="animate-spin"/>:<Trash2/>}Remover nesta vigência</Button>}</div><div className="inline-actions"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button disabled={demo||!!busy||!parsed.ok} onClick={()=>void submit('set')}>{busy==='save'?<LoaderCircle className="animate-spin"/>:<Save/>}Salvar ficha</Button></div></div>
 </DialogContent>;
}
