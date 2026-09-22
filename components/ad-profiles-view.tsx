'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Dialog} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {DataTable,Choice} from './commerce-controls';
import {AdProfileDialog} from './ad-profile-dialog';
import type {MeliListing} from '@/lib/meli/catalog';
import type {AdProfileEvent} from '@/lib/ad-profiles';
import type {OperationOverride} from '@/lib/ad-profiles';
import {latestAdProfile} from '@/lib/ad-profiles';
import type {Sale} from '@/lib/finance';
import {money} from '@/lib/finance';
import type {Account} from '@/lib/demo';
import {formatBasisPoints} from '@/lib/ad-profile-form';
import {CircleDollarSign,Package,Search,Settings2,Tags} from 'lucide-react';

type Filter='all'|'complete'|'pending';
function targetKey(listing:MeliListing){return JSON.stringify([listing.accountId,listing.itemId,listing.variationId]);}
function operationLabel(operation:OperationOverride){return operation==='full'?'Full':operation==='other'?'Comum':'Automática';}
function taxLabel(profile:AdProfileEvent|undefined){const tax=profile?.payload?.tax;if(!tax)return '—';if(tax.mode==='included')return 'Incluído no custo';if(tax.mode==='unit')return `${money(Math.round(tax.valueTenThousandths/100))} / un.`;return `${formatBasisPoints(tax.rateBasisPoints)}%`;}

export function AdProfilesView({listings,profiles,sales,accounts,demo,openTarget,onReload}:{listings:MeliListing[];profiles:AdProfileEvent[];sales:Sale[];accounts:Account[];demo:boolean;openTarget?:{accountId:string;itemId:string;variationId?:string|null}|null;onReload:()=>Promise<void>}){
 const [search,setSearch]=useState('');const [filter,setFilter]=useState<Filter>('all');const [selectedKey,setSelectedKey]=useState<string|null>(null);const [session,setSession]=useState(0);const buttons=useRef(new Map<string,HTMLButtonElement>());const returnKey=useRef<string|null>(null);const openedTarget=useRef('');
 const variationCounts=useMemo(()=>{const map=new Map<string,number>();for(const item of listings){const key=item.accountId+'\0'+item.itemId;map.set(key,(map.get(key)??0)+1)}return map},[listings]);
 const rows=useMemo(()=>listings.map(listing=>{const profile=latestAdProfile(profiles,listing.accountId,listing.itemId,listing.variationId);return {listing,profile,state:profile?.payload?'complete' as const:'pending' as const};}).filter(row=>{
  const haystack=`${row.listing.title} ${row.listing.itemId} ${row.listing.sellerSku??''} ${row.listing.variationId??''} ${accounts.find(account=>account.id===row.listing.accountId)?.name??''}`.toLowerCase();return haystack.includes(search.toLowerCase())&&(filter==='all'||row.state===filter);
 }).sort((a,b)=>a.state.localeCompare(b.state)||a.listing.title.localeCompare(b.listing.title)),[listings,profiles,accounts,search,filter]);
 const selected=listings.find(item=>targetKey(item)===selectedKey);
 function open(listing:MeliListing){const key=targetKey(listing);returnKey.current=key;setSelectedKey(key);setSession(value=>value+1);}
 function close(){setSelectedKey(null);queueMicrotask(()=>{const key=returnKey.current;if(key)buttons.current.get(key)?.focus()});}
 useEffect(()=>{if(!openTarget)return;const key=JSON.stringify([openTarget.accountId,openTarget.itemId,openTarget.variationId??null]);if(openedTarget.current===key)return;const item=listings.find(listing=>targetKey(listing)===key);if(item){openedTarget.current=key;setFilter('all');setSearch(item.itemId);open(item)}},[openTarget,listings]);
 const completed=listings.filter(item=>latestAdProfile(profiles,item.accountId,item.itemId,item.variationId)?.payload).length;
 return <><div className="ad-profile-stats"><section><span>Anúncios e variações</span><strong>{listings.length.toLocaleString('pt-BR')}</strong></section><section><span>Fichas completas</span><strong>{completed.toLocaleString('pt-BR')}</strong></section><section><span>Pedem custo ou imposto</span><strong>{(listings.length-completed).toLocaleString('pt-BR')}</strong></section></div>
  <section className="panel"><div className="panel-heading ad-profile-heading"><div><h2>Fichas financeiras por anúncio</h2><p>Custo e imposto ficam salvos por anúncio e vigência; o Mercado Livre fornece os demais valores.</p></div><div className="ad-profile-tools"><Choice label="Situação da ficha" value={filter} onChange={value=>setFilter(value as Filter)} options={[{value:'all',label:'Todos'},{value:'complete',label:'Completos'},{value:'pending',label:'Pendentes'}]}/><div className="search-field"><Search size={17}/><Input aria-label="Buscar anúncios" placeholder="Anúncio, SKU ou item" value={search} onChange={event=>setSearch(event.target.value)}/></div></div></div>
   <DataTable data={rows} empty="Os anúncios aparecerão depois da sincronização do catálogo." columns={[
    {id:'title',header:'Anúncio',cell:({row})=>{const item=row.original.listing,count=variationCounts.get(item.accountId+'\0'+item.itemId)??1;return <div className="product-cell"><span className="product-icon"><Package size={18}/></span><div><strong>{item.title}</strong><small>{item.sellerSku?`SKU ${item.sellerSku} · `:''}{count>1?`${count} variações · `:''}{item.variationId?`Variação ${item.variationId}`:'Sem variação'}</small></div></div>}},
    {id:'account',header:'Conta',cell:({row})=>accounts.find(account=>account.id===row.original.listing.accountId)?.name??'—'},
    {id:'operation',header:'Operação',cell:({row})=>row.original.profile?.payload?<span className={row.original.profile.payload.operation==='full'?'margin-pill':'neutral-pill'}>{operationLabel(row.original.profile.payload.operation)}</span>:'—'},
    {id:'cost',header:'Custo unitário',cell:({row})=>row.original.profile?.payload?money(Math.round(row.original.profile.payload.unitCostTenThousandths/100)):'—'},
    {id:'tax',header:'Imposto',cell:({row})=>taxLabel(row.original.profile)},
    {id:'validity',header:'Vigência',cell:({row})=>row.original.profile?<div className="table-date"><strong>{row.original.profile.validFrom.split('-').reverse().join('/')}</strong><small>{row.original.profile.origin==='legacy'?'Dados anteriores':'Cadastro'}</small></div>:'—'},
    {id:'state',header:'Estado',cell:({row})=><span className={row.original.state==='complete'?'margin-pill':'pending-pill'}>{row.original.state==='complete'?'Completa':'Pendente'}</span>},
    {id:'action',header:'Ação',cell:({row})=>{const key=targetKey(row.original.listing);return <Button ref={button=>{if(button)buttons.current.set(key,button);else buttons.current.delete(key)}} size="sm" variant="outline" onClick={()=>open(row.original.listing)}>{row.original.state==='complete'?<Settings2/>:<CircleDollarSign/>}{row.original.state==='complete'?'Editar ficha':'Informar dados'}</Button>}},
   ]}/>
  </section><div className="note ad-profile-note"><Tags size={17}/><p>Variações são tratadas separadamente. Uma ficha pode ser copiada dentro da mesma conta sem copiar a modalidade logística.</p></div>
  <Dialog open={!!selected} onOpenChange={value=>!value&&close()}>{selected&&<AdProfileDialog key={`${targetKey(selected)}:${session}`} listing={selected} listings={listings} profiles={profiles} sales={sales} account={accounts.find(account=>account.id===selected.accountId)} demo={demo} onReload={onReload} onClose={close}/>}</Dialog></>;
}
