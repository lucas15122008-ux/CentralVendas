'use client';
import {useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Choice} from './commerce-controls';
import type {Account} from '@/lib/demo';
import type {Sale} from '@/lib/finance';
import {money} from '@/lib/finance';
import type {PendingItem} from '@/lib/pending';
import {saleCorrectionSourceStamp,type CorrectableField,type SaleCorrectionEvent} from '@/lib/sale-corrections';
import {correctionMode,formatCorrectionValue,parseCorrectionValue} from '@/lib/sale-correction-form';
import {History,LoaderCircle,RefreshCw,Save,Trash2} from 'lucide-react';
import {toast} from 'sonner';

const labels:Record<CorrectableField,string>={revenueCents:'Receita líquida',feeCents:'Tarifa do Mercado Livre',shippingCents:'Frete pago pelo vendedor',otherCents:'Descontos e outras despesas',costQuantity:'Quantidade consumida'};
const fields=Object.keys(labels) as CorrectableField[];
function latestFor(events:SaleCorrectionEvent[],field:CorrectableField){return events.filter(event=>event.field===field).sort((a,b)=>b.revision-a.revision)[0];}

export function SaleCorrectionDialog({pending,sale,corrections,account,demo,onReload,onClose}:{pending:PendingItem;sale:Sale;corrections:SaleCorrectionEvent[];account?:Account;demo:boolean;onReload:()=>Promise<void>;onClose:()=>void}){
 const saleEvents=useMemo(()=>corrections.filter(event=>event.accountId===sale.accountId&&event.saleId===sale.id),[corrections,sale]);
 const candidates=useMemo(()=>pending.field?[pending.field]:fields.filter(field=>latestFor(saleEvents,field)?.action==='set'),[pending.field,saleEvents]);
 const [field,setField]=useState<CorrectableField|''>(candidates[0]??'');
 const current=field?latestFor(saleEvents,field):undefined;const correctionApplied=field&&(sale.fieldSources?.[field]==='manual_fallback'||sale.fieldSources?.[field]==='manual_override');const sourceValue=correctionApplied&&current?.action==='set'?current.sourceValue:field?sale[field]:null;const mode=correctionMode(sourceValue);
 const [value,setValue]=useState(current?.value===null||current?.value===undefined?'':field?formatCorrectionValue(field,current.value):'');const [reason,setReason]=useState('');const [busy,setBusy]=useState<'set'|'clear'|null>(null);const [error,setError]=useState('');
 function changeField(next:string){const selected=next as CorrectableField,set=latestFor(saleEvents,selected);setField(selected);setValue(set?.value===null||set?.value===undefined?'':formatCorrectionValue(selected,set.value));setError('');}
 async function submit(action:'set'|'clear'){
  if(!field)return;if(reason.trim().length<3){setError('Explique o motivo em pelo menos 3 caracteres.');return;}
  const parsed=action==='set'?parseCorrectionValue(field,value):null;if(parsed&&!parsed.ok){setError(parsed.message);return;}
  setBusy(action);setError('');try{const response=await fetch('/api/sale-corrections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,requestId:crypto.randomUUID(),accountId:sale.accountId,saleId:sale.id,field,expectedRevision:current?.revision??0,mode,sourceValue,sourceStamp:saleCorrectionSourceStamp(sale,field,sourceValue),reason:reason.trim(),...(action==='set'&&parsed?.ok?{value:parsed.value}:{})})});const result=await response.json() as {error?:string};if(!response.ok)throw Error(result.error);await onReload();toast.success(action==='set'?'Correção salva. A margem foi recalculada.':'Correção removida. O valor automático voltou a valer.');onClose();}catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível salvar a correção.')}finally{setBusy(null)}
 }
 return <DialogContent className="sale-correction-dialog"><DialogHeader><DialogTitle>{pending.kind==='stale_correction'?'Revisar correção':'Informar dado ausente'}</DialogTitle><DialogDescription>Pedido #{sale.orderId} · {sale.title} · {account?.name??'Conta'}</DialogDescription></DialogHeader>
  {!field?<><p className="warning-box"><RefreshCw size={17}/>Esta venda não trouxe informação suficiente para uma correção por campo. Atualize a conta e confira o anúncio vinculado.</p><div className="dialog-actions"><span/><Button onClick={onClose}>Fechar</Button></div></>:<>
   {candidates.length>1&&<label className="form-label">Campo para revisar<Choice label="Campo para revisar" value={field} onChange={changeField} options={candidates.map(value=>({value,label:labels[value]}))}/></label>}
   <section className="correction-comparison"><div><span>Campo</span><strong>{labels[field]}</strong></div><div><span>Mercado Livre</span><strong>{sourceValue===null?'Ainda não informado':field==='costQuantity'?`${sourceValue} un.`:money(sourceValue)}</strong></div><div><span>Tipo de correção</span><strong>{mode==='fallback'?'Valor temporário':'Substituição explícita'}</strong></div></section>
   {mode==='override'&&<p className="warning-box"><RefreshCw size={17}/>O Mercado Livre informou {field==='costQuantity'?`${sourceValue} unidades`:money(sourceValue)}. O novo valor ficará identificado como correção e será revisado se o dado oficial mudar.</p>}
   <label className="form-label">{field==='costQuantity'?'Quantidade correta':'Valor correto'}<Input autoFocus inputMode={field==='costQuantity'?'numeric':'decimal'} value={value} placeholder={field==='costQuantity'?'Ex.: 2':'Ex.: 150,00'} onChange={event=>setValue(event.target.value)}/></label>
   <label className="form-label">Motivo da correção<Textarea maxLength={240} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Ex.: confirmado no extrato mensal"/></label>
   {error&&<p className="error-box" role="alert">{error}</p>}
   {!!saleEvents.filter(event=>event.field===field).length&&<section className="correction-history"><h3><History size={16}/>Histórico deste campo</h3>{saleEvents.filter(event=>event.field===field).sort((a,b)=>b.revision-a.revision).slice(0,6).map(event=><div key={event.id}><span>Revisão {event.revision} · {event.action==='clear'?'Removida':event.mode==='fallback'?'Temporária':'Substituição'}</span><strong>{event.action==='clear'?'—':formatCorrectionValue(field,event.value)} · {event.reason}</strong><small>{new Date(event.createdAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</small></div>)}</section>}
   {demo&&<p className="info-box">A demonstração é somente leitura. Use Minha operação para salvar uma correção.</p>}
   <div className="dialog-actions"><div>{current?.action==='set'&&<Button variant="ghost" disabled={demo||!!busy} onClick={()=>void submit('clear')}>{busy==='clear'?<LoaderCircle className="animate-spin"/>:<Trash2/>}Remover correção</Button>}</div><div className="inline-actions"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button disabled={demo||!!busy||!value.trim()||reason.trim().length<3} onClick={()=>void submit('set')}>{busy==='set'?<LoaderCircle className="animate-spin"/>:<Save/>}Salvar correção</Button></div></div>
  </>}
 </DialogContent>;
}
