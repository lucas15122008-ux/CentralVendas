'use client';
import {useMemo,useRef,useState} from 'react';
import {Dialog} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Choice} from './commerce-controls';
import {SaleCorrectionDialog} from './sale-correction-dialog';
import {RefundBatchDialog} from './refund-batch-dialog';
import {refundBatchSales} from '@/lib/refund-batch';
import type {Account} from '@/lib/demo';
import type {Sale} from '@/lib/finance';
import type {PendingItem} from '@/lib/pending';
import type {SaleCorrectionEvent} from '@/lib/sale-corrections';
import {AlertTriangle,ArrowRight,CircleDollarSign,PackageSearch,RefreshCw,Search,Undo2,Warehouse} from 'lucide-react';

type Filter='all'|'review'|'profile'|'sale'|'full';
const reviewKinds=new Set<PendingItem['kind']>(['stale_correction','stale_full_closure','migration_conflict']);
function kindLabel(item:PendingItem){
 if(item.kind==='stale_correction')return 'Correção mudou';if(item.kind==='stale_full_closure')return 'Fechamento mudou';if(item.kind==='migration_conflict')return 'Revisar dados anteriores';
 if(item.kind==='missing_profile')return 'Ficha ausente';if(item.kind==='missing_cost')return 'Custo ausente';if(item.kind==='missing_tax')return 'Imposto ausente';if(item.kind==='unknown_operation')return 'Operação desconhecida';if(item.kind==='missing_full_reference')return 'Mês Full aberto';return 'Dado do Mercado Livre ausente';
}
function actionLabel(item:PendingItem){return item.action==='edit_profile'?'Configurar anúncio':item.action==='correct_sale'&&item.field?'Informar campo':item.action==='correct_sale'?'Ver venda':item.action==='review_full'?(item.kind==='stale_full_closure'?'Revisar fechamento':'Fechar mês Full'):'Revisar migração';}

export function PendingView({pending,sales,accounts,corrections,demo,onEditAd,onOpenFull,onOpenSales,onReviewMigration,onReload}:{pending:PendingItem[];sales:Sale[];accounts:Account[];corrections:SaleCorrectionEvent[];demo:boolean;onEditAd:(item:PendingItem)=>void;onOpenFull:()=>void;onOpenSales:()=>void;onReviewMigration:()=>void;onReload:()=>Promise<void>}){
 const [filter,setFilter]=useState<Filter>('all');const [search,setSearch]=useState('');const [selectedId,setSelectedId]=useState<string|null>(null);const buttons=useRef(new Map<string,HTMLButtonElement>());const selected=pending.find(item=>item.id===selectedId);const selectedSale=selected?.saleId?sales.find(sale=>sale.id===selected.saleId&&sale.accountId===selected.accountId):undefined;const [refundBatch,setRefundBatch]=useState(false);const refundCount=useMemo(()=>refundBatchSales(sales).length,[sales]);
 const rows=useMemo(()=>pending.filter(item=>{const account=accounts.find(row=>row.id===item.accountId)?.name??'';const matches=`${item.title} ${item.message} ${item.saleId??''} ${item.itemId??''} ${account}`.toLowerCase().includes(search.toLowerCase());const group=reviewKinds.has(item.kind)?'review':item.action==='edit_profile'?'profile':item.action==='review_full'?'full':'sale';return matches&&(filter==='all'||filter===group)}),[pending,accounts,search,filter]);
 const review=pending.filter(item=>reviewKinds.has(item.kind)).length,full=pending.filter(item=>item.action==='review_full').length;
 function close(){const id=selectedId;setSelectedId(null);queueMicrotask(()=>{if(id)buttons.current.get(id)?.focus()});}
 function act(item:PendingItem){if(item.action==='edit_profile')onEditAd(item);else if(item.action==='review_full')onOpenFull();else if(item.action==='review_migration')onReviewMigration();else if(item.field||item.kind==='stale_correction')setSelectedId(item.id);else onOpenSales();}
 return <><div className="pending-stats"><section><span>Pedem atenção</span><strong>{pending.length.toLocaleString('pt-BR')}</strong></section><section><span>Precisam ser revisadas</span><strong>{review.toLocaleString('pt-BR')}</strong></section><section><span>Ligadas ao Full</span><strong>{full.toLocaleString('pt-BR')}</strong></section></div>
  <section className="panel"><div className="panel-heading pending-heading"><div><h2>Só o que precisa da sua decisão</h2><p>Os dados automáticos continuam entrando sozinhos. Aqui aparecem apenas exceções.</p></div><div className="pending-tools"><Choice label="Tipo de pendência" value={filter} onChange={value=>setFilter(value as Filter)} options={[{value:'all',label:'Todas'},{value:'review',label:'Revisar'},{value:'profile',label:'Anúncios'},{value:'sale',label:'Vendas'},{value:'full',label:'Full'}]}/>{refundCount>0&&<Button variant="outline" onClick={()=>setRefundBatch(true)}><Undo2/>Resolver {refundCount.toLocaleString('pt-BR')} devoluções em lote</Button>}<div className="search-field"><Search size={17}/><Input aria-label="Buscar pendências" placeholder="Produto, pedido ou anúncio" value={search} onChange={event=>setSearch(event.target.value)}/></div></div></div>
   <div className="pending-list">{rows.length?rows.map(item=>{const reviewing=reviewKinds.has(item.kind);return <article key={item.id} className={reviewing?'pending-card review':'pending-card'}><span className="pending-card-icon">{item.action==='edit_profile'?<PackageSearch/>:item.action==='review_full'?<Warehouse/>:reviewing?<RefreshCw/>:<CircleDollarSign/>}</span><div className="pending-card-copy"><div><span className={reviewing?'pending-pill':'neutral-pill'}>{kindLabel(item)}</span><small>{accounts.find(account=>account.id===item.accountId)?.name??'Conta'}</small></div><h3>{item.title}</h3><p>{item.message}</p>{item.saleId&&<span className="pending-reference">Venda {item.saleId.split(':').at(-2)??item.saleId}</span>}{item.itemId&&<span className="pending-reference">Anúncio {item.itemId}{item.variationId?` · variação ${item.variationId}`:''}</span>}</div><Button ref={button=>{if(button)buttons.current.set(item.id,button);else buttons.current.delete(item.id)}} variant={reviewing?'default':'outline'} onClick={()=>act(item)}>{actionLabel(item)}<ArrowRight/></Button></article>}):<div className="pending-empty"><span><AlertTriangle/></span><h3>Nenhuma pendência neste filtro</h3><p>Os cálculos estão completos para os itens exibidos.</p></div>}</div>
  </section><div className="note pending-note"><AlertTriangle size={17}/><p>Um valor informado manualmente fica identificado e é revisto quando o Mercado Livre envia um dado novo.</p></div>
  <Dialog open={!!selected&&!!selectedSale} onOpenChange={open=>!open&&close()}>{selected&&selectedSale&&<SaleCorrectionDialog key={selected.id} pending={selected} sale={selectedSale} corrections={corrections} account={accounts.find(account=>account.id===selected.accountId)} demo={demo} onReload={onReload} onClose={close}/>}</Dialog>
  <Dialog open={refundBatch} onOpenChange={setRefundBatch}>{refundBatch&&<RefundBatchDialog sales={sales} corrections={corrections} demo={demo} onReload={onReload} onClose={()=>setRefundBatch(false)}/>}</Dialog></>;
}
