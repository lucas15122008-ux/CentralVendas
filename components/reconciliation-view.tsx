'use client';
import {useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {DataTable,Choice} from './commerce-controls';
import {calculateSale,money,summarizeSales,type CostRecord,type ReconciliationAmounts,type Sale,type SaleResult} from '@/lib/finance';
import {activeProductLink,initialReconciliationAmounts,productTargetKey,reconciliationStatus,type ReconciliationEvent} from '@/lib/reconciliation';
import type {Account} from '@/lib/demo';
import {businessDate} from '@/lib/dates';
import {CheckCircle2,ClipboardCheck,History,Link2,LoaderCircle,Package,RefreshCw,Search,TriangleAlert,Unlink} from 'lucide-react';
import {toast} from 'sonner';
import {FullClosurePanel} from './full-closure-panel';
import type {FullClosureSummary} from '@/lib/demo';

type StatusFilter='attention'|'all'|'manual'|'automatic';
const amountFields:[keyof ReconciliationAmounts,string,string][]=[['revenueCents','Receita líquida','Valor recebido pelos itens'],['feeCents','Tarifas','Tarifas do Mercado Livre'],['shippingCents','Frete do vendedor','Parcela de frete paga pela operação'],['otherCents','Outras despesas','Descontos e despesas variáveis'],['costCents','Custo consumido','Custo total das unidades'],['taxCents','Imposto adicional','Use zero quando já estiver incluído no custo'],['fullExpenseCents','Despesa adicional Full','Armazenagem e outras despesas exclusivas do Full']];
const statusLabel={stale:'Revisar ajuste','manual-pending':'Manual pendente',manual:'Conciliada',pending:'Pendente',automatic:'Automática'} as const;
const centsToInput=(value:number|null|undefined)=>value===null||value===undefined?'':(value/100).toFixed(2).replace('.',',');
function inputToCents(value:string){const compact=value.trim().replace(/\s/g,'');if(!compact)return null;const normalized=compact.includes(',')?compact.replace(/\./g,'').replace(',','.'):compact;const number=Number(normalized);if(!Number.isFinite(number)||number<0)return undefined;return Math.round(number*100);}

export function ReconciliationView({sales,costs,accounts,events,closures,demo,onReload}:{sales:Sale[];costs:CostRecord[];accounts:Account[];events:ReconciliationEvent[];closures:FullClosureSummary[];demo:boolean;onReload:()=>Promise<void>}){
 const [search,setSearch]=useState('');const [filter,setFilter]=useState<StatusFilter>('attention');const [selectedId,setSelectedId]=useState<string|null>(null);
 const calculated=useMemo(()=>summarizeSales(sales,costs).rows,[sales,costs]);
 const selected=selectedId?calculated.find(row=>row.id===selectedId)??null:null;
 const rows=calculated.filter(row=>{
  const matches=`${row.orderId} ${row.title} ${row.sku} ${row.costSku??''}`.toLowerCase().includes(search.toLowerCase());const value=reconciliationStatus(row);
  return matches&&(filter==='all'||filter==='attention'&&['pending','manual-pending','stale'].includes(value)||filter==='manual'&&value==='manual'||filter==='automatic'&&value==='automatic');
 }).sort((a,b)=>{const order={stale:0,'manual-pending':1,pending:2,manual:3,automatic:4};return order[reconciliationStatus(a)]-order[reconciliationStatus(b)]||b.date.localeCompare(a.date)});
 const stats={attention:calculated.filter(row=>['stale','manual-pending','pending'].includes(reconciliationStatus(row))).length,stale:calculated.filter(row=>reconciliationStatus(row)==='stale').length,manual:calculated.filter(row=>reconciliationStatus(row)==='manual').length,automatic:calculated.filter(row=>reconciliationStatus(row)==='automatic').length};
 return <><FullClosurePanel accounts={accounts} closures={closures} demo={demo} onReload={onReload}/><div className="reconciliation-stats"><div><span>Pedem atenção</span><strong>{stats.attention}</strong></div><div><span>Ajustes para revisar</span><strong>{stats.stale}</strong></div><div><span>Conciliadas manualmente</span><strong>{stats.manual}</strong></div><div><span>Calculadas automaticamente</span><strong>{stats.automatic}</strong></div></div>
 <section className="panel"><div className="panel-heading reconciliation-heading"><div><h2>Conciliação das vendas</h2><p>Vincule anúncios à planilha e confirme os valores que não vieram completos.</p></div><div className="reconciliation-tools"><Choice label="Situação" value={filter} onChange={value=>setFilter(value as StatusFilter)} options={[{value:'attention',label:'Pedem atenção'},{value:'all',label:'Todas as vendas'},{value:'manual',label:'Conciliadas'},{value:'automatic',label:'Automáticas'}]}/><div className="search-field"><Search size={17}/><Input aria-label="Buscar conciliação" placeholder="Pedido, produto ou SKU" value={search} onChange={event=>setSearch(event.target.value)}/></div></div></div>
 <DataTable data={rows} empty={filter==='attention'?'Nenhuma venda pede conciliação neste período.':'Nenhuma venda encontrada.'} columns={[
  {accessorKey:'orderId',header:'Pedido',cell:({row})=><button className="order-link" onClick={()=>setSelectedId(row.original.id)}>#{row.original.orderId}<small>{row.original.date.split('-').reverse().join('/')}</small></button>},
  {accessorKey:'title',header:'Produto',cell:({row})=><div className="product-cell"><span className="product-icon"><Package size={18}/></span><div><strong>{row.original.title}</strong><small>SKU da venda {row.original.sku}{row.original.costSku?` · custo ${row.original.costSku}`:''}</small></div></div>},
  {accessorKey:'accountId',header:'Conta',cell:({getValue})=>accounts.find(account=>account.id===getValue())?.name},
  {id:'status',header:'Situação',cell:({row})=>{const value=reconciliationStatus(row.original);return <span className={value==='manual'?'margin-pill':value==='automatic'?'neutral-pill':'pending-pill'}>{statusLabel[value]}</span>}},
  {accessorKey:'contributionCents',header:'Contribuição',cell:({row})=>row.original.contributionCents===null?<span className="pending-pill">A conferir</span>:<div className="result-cell"><strong>{money(row.original.contributionCents)}</strong>{row.original.resultState==='provisional'&&<small>Provisória</small>}{row.original.resultState==='closed'&&<small>Fechada</small>}</div>},
  {id:'action',header:'Ação',cell:({row})=><Button size="sm" variant="outline" onClick={()=>setSelectedId(row.original.id)}>{reconciliationStatus(row.original)==='automatic'?'Conferir':'Conciliar'}</Button>},
 ]}/></section>
 <div className="note reconciliation-note"><ClipboardCheck size={17}/><p>Os dados originais do Mercado Livre e da planilha permanecem intactos. Cada correção cria uma nova revisão com data e motivo.</p></div>
 <Dialog open={!!selected} onOpenChange={open=>!open&&setSelectedId(null)}>{selected&&<ReconciliationEditor key={`${selected.id}:${selected.sourceStamp}:${selected.saleRevision}`} sale={selected} costs={costs} events={events} account={accounts.find(item=>item.id===selected.accountId)} demo={demo} onReload={onReload} onClose={()=>setSelectedId(null)}/>}</Dialog></>;
}

function ReconciliationEditor({sale,costs,events,account,demo,onReload,onClose}:{sale:SaleResult;costs:CostRecord[];events:ReconciliationEvent[];account?:Account;demo:boolean;onReload:()=>Promise<void>;onClose:()=>void}){
 const automatic=calculateSale({...sale,reconciliation:undefined},costs);
 const initial=initialReconciliationAmounts(sale,{revenueCents:sale.revenueCents,feeCents:sale.feeCents,shippingCents:sale.shippingCents,otherCents:sale.otherCents,costCents:automatic.costCents,taxCents:automatic.taxCents,fullExpenseCents:0});
 const [values,setValues]=useState<Record<keyof ReconciliationAmounts,string>>(Object.fromEntries(amountFields.map(([key])=>[key,centsToInput(initial[key])])) as Record<keyof ReconciliationAmounts,string>);
 const [channel,setChannel]=useState(sale.reconciliation?.channel??'unknown');const [reason,setReason]=useState('');const [busy,setBusy]=useState<'sale'|'link'|'clear'|null>(null);const [error,setError]=useState('');
 const accountCosts=useMemo(()=>Object.values(costs.filter(cost=>cost.accountId===sale.accountId).sort((a,b)=>b.validFrom.localeCompare(a.validFrom)||b.importedAt.localeCompare(a.importedAt)).reduce((all,cost)=>{if(!all[cost.sku])all[cost.sku]=cost;return all},{} as Record<string,CostRecord>)).sort((a,b)=>a.sku.localeCompare(b.sku,'pt-BR')),[costs,sale.accountId]);
 const defaultLinkDate=sale.linkValidFrom??accountCosts.find(cost=>cost.sku===(sale.costSku??sale.sku))?.validFrom??businessDate();const [linkSku,setLinkSku]=useState(sale.costSku??'');const [linkDate,setLinkDate]=useState(defaultLinkDate);
 const target=sale.itemId?productTargetKey(sale.itemId,sale.variationId):null;
 const currentLink=activeProductLink(events,sale);const linkChannel=currentLink?.payload?.kind==='product'?currentLink.payload.channel??'unknown':'unknown';
 const linkRevision=events.filter(event=>event.accountId===sale.accountId&&event.targetType==='product'&&event.targetKey===target&&event.validFrom===linkDate).reduce((revision,event)=>Math.max(revision,event.revision),0);
 const history=events.filter(event=>event.accountId===sale.accountId&&(event.targetType==='sale'&&event.targetKey===sale.id||!!target&&event.targetType==='product'&&event.targetKey===target)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.revision-a.revision);
 async function send(body:object,kind:'sale'|'link'|'clear'){
  setBusy(kind);setError('');try{const response=await fetch('/api/reconciliation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json() as {error?:string};if(!response.ok)throw Error(result.error);await onReload();toast.success(kind==='link'?'Vínculo salvo. Valores recalculados.':kind==='clear'?'Ajuste removido. Histórico preservado.':'Venda conciliada.');}catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível salvar a conciliação.')}finally{setBusy(null)}
 }
 async function saveLink(action:'set'|'clear'){
  if(!sale.itemId)return;if(reason.trim().length<3){setError('Explique o motivo da alteração.');return;}if(action==='set'&&!linkSku){setError('Selecione um SKU da planilha.');return;}
  await send({kind:'product',action,requestId:crypto.randomUUID(),accountId:sale.accountId,itemId:sale.itemId,variationId:sale.variationId??null,validFrom:linkDate,expectedRevision:linkRevision,...(action==='set'?{sku:linkSku,channel:linkChannel}:{}),reason:reason.trim()},action==='set'?'link':'clear');
 }
 async function saveSale(action:'set'|'clear'){
  if(reason.trim().length<3){setError('Explique o motivo da alteração.');return;}if(action==='clear'){await send({kind:'sale',action,requestId:crypto.randomUUID(),accountId:sale.accountId,saleId:sale.id,expectedRevision:sale.saleRevision??0,reason:reason.trim()},'clear');return;}
  const parsed={} as ReconciliationAmounts;for(const [key] of amountFields){const value=inputToCents(values[key]);if(value===undefined){setError('Use valores positivos em reais, como 150,00. Deixe vazio quando ainda não souber.');return;}parsed[key]=value;}
  await send({kind:'sale',action,requestId:crypto.randomUUID(),accountId:sale.accountId,saleId:sale.id,expectedRevision:sale.saleRevision??0,sourceStamp:sale.sourceStamp,channel,amounts:parsed,reason:reason.trim()},'sale');
 }
 return <DialogContent className="reconciliation-dialog"><DialogHeader><DialogTitle>Conciliar pedido #{sale.orderId}</DialogTitle><DialogDescription>{sale.title} · {account?.name} · {sale.date.split('-').reverse().join('/')}</DialogDescription></DialogHeader>
  {sale.reconciliation?.state==='stale'&&<div className="warning-box"><RefreshCw size={17}/><p>A venda ou o custo mudou depois da última conferência. Revise os valores e salve uma nova versão.</p></div>}
  {demo&&<p className="info-box">A demonstração é somente leitura. Entre na operação real para salvar vínculos e ajustes.</p>}
  <section className="reconciliation-section"><div className="section-title"><Link2 size={17}/><div><h3>Vínculo com a planilha</h3><p>O vínculo vale para este anúncio e variação a partir da vigência escolhida.</p></div></div>{sale.itemId?<><div className="form-grid"><label>SKU de custo<Choice label="SKU de custo" value={linkSku||'none'} onChange={value=>setLinkSku(value==='none'?'':value)} options={[{value:'none',label:'Selecionar SKU'},...accountCosts.map(cost=>({value:cost.sku,label:`${cost.sku} · ${cost.description||'Sem descrição'} · ${money(Math.round(cost.unitCost*100))}`}))]}/></label><label>Válido a partir de<Input type="date" value={linkDate} onChange={event=>setLinkDate(event.target.value)}/></label></div><p className="note-text">Para vendas antigas, só antecipe a vigência se esse custo realmente valia naquela data. Também é possível informar o custo apenas nesta venda abaixo.</p><div className="inline-actions"><Button variant="outline" disabled={demo||!!busy||!linkSku} onClick={()=>void saveLink('set')}>{busy==='link'?<LoaderCircle className="animate-spin"/>:<Link2/>}Salvar vínculo</Button>{linkRevision>0&&<Button variant="ghost" disabled={demo||!!busy} onClick={()=>void saveLink('clear')}><Unlink/>Remover nesta vigência</Button>}</div></>:<p className="note-text">Esta venda não trouxe o identificador do anúncio. Use o ajuste individual abaixo.</p>}</section>
  <section className="reconciliation-section"><div className="section-title"><ClipboardCheck size={17}/><div><h3>Composição desta venda</h3><p>Valores totais do item no pedido. Campos vazios continuam pendentes.</p></div></div><label className="form-label">Operação<Choice label="Tipo da operação" value={channel} onChange={value=>setChannel(value as typeof channel)} options={[{value:'unknown',label:'Ainda não classificada'},{value:'other',label:'Venda comum'},{value:'full',label:'Mercado Livre Full'}]}/></label><div className="amount-grid">{amountFields.map(([key,label,help])=><label key={key}>{label}<Input inputMode="decimal" value={values[key]} placeholder="Não informado" onChange={event=>setValues({...values,[key]:event.target.value})}/><small>{help}</small></label>)}</div></section>
  <label className="form-label">Motivo da alteração<Textarea maxLength={240} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Ex.: custo e despesas do Full conferidos no relatório"/></label>
  {error&&<p className="error-box" role="alert">{error}</p>}
  {history.length>0&&<section className="reconciliation-history"><div className="section-title"><History size={16}/><h3>Histórico</h3></div>{history.slice(0,6).map(event=><div key={event.id}><span>{event.targetType==='product'?'Vínculo de produto':'Ajuste da venda'} · revisão {event.revision}</span><strong>{event.action==='clear'?'Removido':event.reason}</strong><small>{new Date(event.createdAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</small></div>)}</section>}
  <div className="dialog-actions"><div>{sale.reconciliation&&<Button variant="ghost" disabled={demo||!!busy} onClick={()=>void saveSale('clear')}>{busy==='clear'?<LoaderCircle className="animate-spin"/>:<Unlink/>}Remover ajuste</Button>}</div><div className="inline-actions"><Button variant="ghost" onClick={onClose}>Fechar</Button><Button disabled={demo||!!busy||!sale.sourceStamp} onClick={()=>void saveSale('set')}>{busy==='sale'?<LoaderCircle className="animate-spin"/>:sale.reconciliation?.state==='manual'?<CheckCircle2/>:<TriangleAlert/>}{sale.reconciliation?'Salvar nova revisão':'Confirmar venda'}</Button></div></div>
 </DialogContent>;
}
