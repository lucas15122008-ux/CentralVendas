'use client';
import {useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';import {toast} from 'sonner';
import {DataTable} from './commerce-controls';
import {money,percent,summarizeSales,type CostRecord,type Sale} from '@/lib/finance';
import {summarizeAdvertising,type AdSpend,type AdsAccountState} from '@/lib/advertising';
import type {Account} from '@/lib/demo';
import type {MeliListing} from '@/lib/meli/catalog';
import {Megaphone,MousePointerClick,ChartNoAxesCombined,Target,RefreshCw,LoaderCircle,Info,Package} from 'lucide-react';

function statusText(state:AdsAccountState|undefined){
 if(!state)return {tone:'note',text:'A publicidade ainda não foi lida. Use Atualizar publicidade ou aguarde a atualização automática.'};
 if(state.state==='forbidden')return {tone:'warning',text:state.error??'A aplicação não tem acesso à Publicidade. Ative a permissão no portal do Mercado Livre e reconecte a conta.'};
 if(state.state==='no_advertiser')return {tone:'note',text:'Nenhuma conta de Mercado Ads encontrada para este vendedor.'};
 if(state.state==='error')return {tone:'warning',text:state.error??'A última leitura da publicidade falhou. Tente atualizar novamente.'};
 return {tone:'ok',text:state.lastFetchedAt?`Lido em ${new Date(state.lastFetchedAt).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}`:'Conectado ao Mercado Ads'};
}

export function AdvertisingView({spend,status,sales,costs,accounts,listings,demo,onReload}:{spend:AdSpend[];status:AdsAccountState[];sales:Sale[];costs:CostRecord[];accounts:Account[];listings:MeliListing[];demo:boolean;onReload:()=>Promise<void>}){
 const [busy,setBusy]=useState('');
 const summary=useMemo(()=>summarizeSales(sales,costs),[sales,costs]);
 const titles=useMemo(()=>new Map(listings.map(listing=>[listing.accountId+'\0'+listing.itemId,listing.title])),[listings]);
 const ads=useMemo(()=>summarizeAdvertising(spend,summary.rows,titles),[spend,summary.rows,titles]);
 const afterAds=summary.contributionCents-ads.costCents;
 const tacos=summary.revenueCents>0?ads.costCents/summary.revenueCents*100:null;
 async function refresh(accountId:string){
  setBusy(accountId);
  try{
   for(let round=0;round<20;round++){
    const r=await fetch('/api/meli/ads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId})});
    const data=await r.json() as {status?:string;state?:string;error?:string};
    if(!r.ok)throw Error(data.error||'Não foi possível ler a publicidade.');
    if(data.status==='complete'){toast.success(data.state==='active'?'Publicidade atualizada.':'Leitura concluída. Confira o aviso da conta.');break;}
   }
  }catch(e){toast.error(e instanceof Error?e.message:'Não foi possível ler a publicidade.')}
  finally{setBusy('');await onReload()}
 }
 return <>
  <section className="panel ads-status">{accounts.map(account=>{const state=status.find(item=>item.accountId===account.id),info=statusText(state);return <div className="ads-status-row" key={account.id}><div><strong>{account.name}</strong><p className={info.tone==='warning'?'negative':'muted'}>{info.text}</p></div>{!demo&&<Button variant="outline" size="sm" disabled={!!busy} onClick={()=>void refresh(account.id)}>{busy===account.id?<LoaderCircle className="animate-spin"/>:<RefreshCw/>}Atualizar publicidade</Button>}</div>})}</section>
  <div className="metric-grid">
   <section className="metric-card primary-metric"><div className="metric-label">Investimento em Ads <Megaphone size={18}/></div><strong>{money(ads.costCents)}</strong><div className="metric-foot"><span>{percent(tacos)} da receita (TACOS)</span><span className="tag-dark">BRL</span></div></section>
   <section className="metric-card"><div className="metric-label">Vendas atribuídas <Target size={18}/></div><strong>{money(ads.attributedCents)}</strong><div className="metric-foot"><span className="muted">ACOS</span><span>{percent(ads.acos)}</span></div></section>
   <section className="metric-card"><div className="metric-label">Contribuição após publicidade <ChartNoAxesCombined size={18}/></div><strong className={afterAds>=0?'positive':'negative'}>{money(afterAds)}</strong><div className="metric-foot"><span className="muted">Antes dos Ads</span><span>{money(summary.contributionCents)}</span></div></section>
   <section className="metric-card"><div className="metric-label">Cliques <MousePointerClick size={18}/></div><strong>{ads.clicks.toLocaleString('pt-BR')}</strong><div className="metric-foot"><span className="muted">{ads.prints.toLocaleString('pt-BR')} impressões</span><span>{money(ads.clicks?Math.round(ads.costCents/ads.clicks):null)} por clique</span></div></section>
  </div>
  <section className="panel"><div className="panel-heading"><div><h2>Anúncios com publicidade</h2><p>Investimento do período descontado da contribuição de cada anúncio</p></div></div>
   <DataTable data={ads.items} empty="Nenhum gasto com Mercado Ads no período." columns={[
    {accessorKey:'title',header:'Anúncio',cell:({row})=><div className="product-cell"><span className="product-icon"><Package size={18}/></span><div><strong>{row.original.title}</strong><small>{row.original.itemId} · {accounts.find(a=>a.id===row.original.accountId)?.name}</small></div></div>},
    {accessorKey:'costCents',header:'Investimento',cell:({getValue})=>money(Number(getValue()))},
    {accessorKey:'attributedCents',header:'Vendas atribuídas',cell:({getValue})=>money(Number(getValue()))},
    {accessorKey:'acos',header:'ACOS',cell:({row})=><span className={(row.original.contributionAfterAdsCents??0)<0?'pending-pill':'margin-pill'}>{percent(row.original.acos)}</span>},
    {accessorKey:'contributionCents',header:'Contribuição',cell:({row})=>row.original.complete?money(row.original.contributionCents):<span className="pending-pill">A conferir</span>},
    {accessorKey:'contributionAfterAdsCents',header:'Após Ads',cell:({row})=>row.original.contributionAfterAdsCents===null?<span className="pending-pill">A conferir</span>:<strong className={row.original.contributionAfterAdsCents>=0?'positive':'negative'}>{money(row.original.contributionAfterAdsCents)}</strong>},
   ]}/>
   <div className="note ads-note"><Info size={15}/><p>O Mercado Ads cobra por clique em cada anúncio, não por venda. Por isso o investimento é descontado no total do anúncio e do período, e a contribuição de cada venda continua antes da publicidade. Os últimos dois dias ainda podem mudar.</p></div>
  </section>
 </>;
}
