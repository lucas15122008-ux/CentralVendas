'use client';
import {useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Choice} from './commerce-controls';
import type {Sale} from '@/lib/finance';
import {refundBatchCorrections,refundBatchSales} from '@/lib/refund-batch';
import type {SaleCorrectionEvent} from '@/lib/sale-corrections';
import {CheckCircle2,LoaderCircle} from 'lucide-react';
import {toast} from 'sonner';

export function RefundBatchDialog({sales,corrections,demo,onReload,onClose}:{sales:Sale[];corrections:SaleCorrectionEvent[];demo:boolean;onReload:()=>Promise<void>;onClose:()=>void}){
 const [stock,setStock]=useState<'returned'|'lost'>('returned');const [fee,setFee]=useState<'refunded'|'charged'>('refunded');const [reason,setReason]=useState('Devolução ou cancelamento total conferido no Mercado Livre');
 const [busy,setBusy]=useState(false);const [progress,setProgress]=useState(0);const [error,setError]=useState('');
 const targets=useMemo(()=>refundBatchSales(sales),[sales]);
 const commands=useMemo(()=>refundBatchCorrections(sales,corrections,{stockReturned:stock==='returned',feeRefunded:fee==='refunded',reason:reason.trim()}),[sales,corrections,stock,fee,reason]);
 async function apply(){
  if(reason.trim().length<3){setError('Explique o motivo em pelo menos 3 caracteres.');return;}
  setBusy(true);setError('');setProgress(0);let failed=0;
  for(const [index,command] of commands.entries()){
   try{const response=await fetch('/api/sale-corrections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...command,requestId:crypto.randomUUID()})});if(!response.ok)failed++;}catch{failed++;}
   setProgress(index+1);
  }
  await onReload();setBusy(false);
  if(failed){setError(`${failed} de ${commands.length} campos não foram salvos. Recarregue a página e aplique de novo para concluir.`);return;}
  toast.success(`${targets.length} vendas devolvidas resolvidas.`);onClose();
 }
 return <DialogContent className="sale-correction-dialog"><DialogHeader><DialogTitle>Resolver devoluções em lote</DialogTitle><DialogDescription>{targets.length.toLocaleString('pt-BR')} vendas canceladas ou devolvidas aguardam receita ou quantidade.</DialogDescription></DialogHeader>
  <p className="info-box">Use somente para cancelamentos e devoluções totais. A receita fica zerada; frete e descontos ainda não informados ficam zerados. Um reembolso parcial deve ser corrigido pela própria venda.</p>
  <label className="form-label">O produto voltou para o estoque?<Choice label="Estoque" value={stock} onChange={value=>setStock(value as 'returned'|'lost')} options={[{value:'returned',label:'Sim, voltou ao estoque (custo zero)'},{value:'lost',label:'Não, foi perdido (custo do produto conta)'}]}/></label>
  <label className="form-label">A tarifa de venda foi estornada?<Choice label="Tarifa" value={fee} onChange={value=>setFee(value as 'refunded'|'charged')} options={[{value:'refunded',label:'Sim, o Mercado Livre devolveu a tarifa'},{value:'charged',label:'Não, a tarifa foi cobrada'}]}/></label>
  <label className="form-label">Motivo<Textarea maxLength={240} value={reason} onChange={event=>setReason(event.target.value)}/></label>
  {busy&&<p className="info-box"><LoaderCircle className="animate-spin" size={17}/>Salvando {progress} de {commands.length} campos…</p>}
  {error&&<p className="error-box" role="alert">{error}</p>}
  {demo&&<p className="info-box">A demonstração é somente leitura.</p>}
  <div className="dialog-actions"><span/><div className="inline-actions"><Button variant="ghost" disabled={busy} onClick={onClose}>Cancelar</Button><Button disabled={demo||busy||!commands.length||reason.trim().length<3} onClick={()=>void apply()}>{busy?<LoaderCircle className="animate-spin"/>:<CheckCircle2/>}Aplicar em {targets.length.toLocaleString('pt-BR')} vendas</Button></div></div>
 </DialogContent>;
}

