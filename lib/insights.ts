import {periodStart} from './dates.ts';
import {calculateSale,money,percent,type CostRecord,type Sale,type SaleResult} from './finance.ts';
import {summarizeAdvertising,type AdSpend} from './advertising.ts';
import type {MeliListing} from './meli/catalog.ts';

export type InsightKind='negative_listing'|'ads_eat_margin'|'ads_without_sales'|'sales_drop'|'low_margin'|'idle_listings'|'low_coverage';
export type InsightSeverity='critical'|'warning'|'info';
export type Insight={
 id:string;kind:InsightKind;severity:InsightSeverity;accountId:string|null;itemId?:string;
 title:string;detail:string;impactCents:number;action:'advertising'|'ads'|'pending'|'sales';
};

export const INSIGHT_WINDOW_DAYS=30;
export const LOW_MARGIN_PERCENT=5;
export const DROP_MIN_REVENUE_CENTS=30000;
export const DROP_RATIO=0.5;

const severityOrder:Record<InsightSeverity,number>={critical:0,warning:1,info:2};
type ItemTotals={accountId:string;itemId:string;title:string;revenueCents:number;contributionCents:number;complete:boolean;units:number};

function itemTotals(rows:SaleResult[]){
 const items=new Map<string,ItemTotals>();
 for(const row of rows){
  if(!row.itemId||row.status!=='paid')continue;
  const key=row.accountId+'\0'+row.itemId;
  const saved=items.get(key)??{accountId:row.accountId,itemId:row.itemId,title:row.title,revenueCents:0,contributionCents:0,complete:true,units:0};
  saved.revenueCents+=row.revenueCents??0;saved.contributionCents+=row.contributionCents??0;saved.complete&&=row.contributionCents!==null;saved.units+=row.quantity;
  items.set(key,saved);
 }
 return items;
}

// Insights only read data the Central already trusts: incomplete results never raise margin alerts.
export function collectInsights(input:{sales:Sale[];costs:CostRecord[];listings:MeliListing[];adSpend:AdSpend[];now?:Date}):Insight[]{
 const now=input.now??new Date();
 const from=periodStart(INSIGHT_WINDOW_DAYS,now),lastWeek=periodStart(7,now),previousWeek=periodStart(14,now);
 const rows=input.sales.filter(sale=>sale.date>=from&&sale.status!=='cancelled'&&sale.status!=='pending').map(sale=>calculateSale(sale,input.costs));
 const spend=input.adSpend.filter(row=>row.date>=from);
 const titles=new Map(input.listings.map(listing=>[listing.accountId+'\0'+listing.itemId,listing.title]));
 const ads=summarizeAdvertising(spend,rows,titles);
 const adsByItem=new Map(ads.items.map(item=>[item.accountId+'\0'+item.itemId,item]));
 const insights:Insight[]=[];
 const items=itemTotals(rows);

 for(const [key,item] of items){
  if(!item.complete)continue;
  const ad=adsByItem.get(key);
  const afterAds=item.contributionCents-(ad?.costCents??0);
  const margin=item.revenueCents>0?item.contributionCents/item.revenueCents*100:null;
  if(item.contributionCents<0){
   insights.push({id:'negative_listing:'+key,kind:'negative_listing',severity:'critical',accountId:item.accountId,itemId:item.itemId,title:item.title,detail:`Perdeu ${money(-item.contributionCents)} em ${item.units} unidades nos últimos ${INSIGHT_WINDOW_DAYS} dias, antes da publicidade. Revise preço, custo ou frete.`,impactCents:-afterAds,action:'ads'});
  }else if(ad&&ad.costCents>0&&afterAds<0){
   insights.push({id:'ads_eat_margin:'+key,kind:'ads_eat_margin',severity:'critical',accountId:item.accountId,itemId:item.itemId,title:item.title,detail:`Contribuiu ${money(item.contributionCents)}, mas o Ads custou ${money(ad.costCents)}: sobra ${money(afterAds)}. ACOS ${percent(ad.acos)}.`,impactCents:-afterAds,action:'advertising'});
  }else if(margin!==null&&margin<LOW_MARGIN_PERCENT){
   insights.push({id:'low_margin:'+key,kind:'low_margin',severity:'warning',accountId:item.accountId,itemId:item.itemId,title:item.title,detail:`Margem de ${percent(margin)} antes da publicidade em ${money(item.revenueCents)} de receita.`,impactCents:Math.round(item.revenueCents*LOW_MARGIN_PERCENT/100)-item.contributionCents,action:'ads'});
  }
 }

 for(const ad of ads.items){
  if(ad.costCents>0&&ad.units===0)insights.push({id:'ads_without_sales:'+ad.accountId+'\0'+ad.itemId,kind:'ads_without_sales',severity:'warning',accountId:ad.accountId,itemId:ad.itemId,title:ad.title,detail:`${money(ad.costCents)} em Ads e ${ad.clicks.toLocaleString('pt-BR')} cliques sem nenhuma venda paga no período.`,impactCents:ad.costCents,action:'advertising'});
 }

 const weekly=new Map<string,{accountId:string;itemId:string;title:string;recent:number;previous:number}>();
 for(const sale of input.sales){
  if(!sale.itemId||sale.status!=='paid'||sale.date<previousWeek)continue;
  const key=sale.accountId+'\0'+sale.itemId;
  const saved=weekly.get(key)??{accountId:sale.accountId,itemId:sale.itemId,title:sale.title,recent:0,previous:0};
  const value=sale.grossSalesCents??sale.revenueCents??0;
  if(sale.date>=lastWeek)saved.recent+=value;else saved.previous+=value;
  weekly.set(key,saved);
 }
 for(const [key,item] of weekly){
  if(item.previous<DROP_MIN_REVENUE_CENTS||item.recent>item.previous*DROP_RATIO)continue;
  const drop=Math.round((1-item.recent/item.previous)*100);
  insights.push({id:'sales_drop:'+key,kind:'sales_drop',severity:'warning',accountId:item.accountId,itemId:item.itemId,title:item.title,detail:`Faturou ${money(item.recent)} nos últimos 7 dias contra ${money(item.previous)} na semana anterior (queda de ${drop}%). Confira estoque, preço e posição do anúncio.`,impactCents:item.previous-item.recent,action:'sales'});
 }

 const sold=new Set(input.sales.filter(sale=>sale.date>=from&&sale.itemId).map(sale=>sale.accountId+'\0'+sale.itemId));
 const idle=new Map<string,Set<string>>();
 for(const listing of input.listings){
  if(listing.status!=='active'||sold.has(listing.accountId+'\0'+listing.itemId))continue;
  const set=idle.get(listing.accountId)??new Set<string>();set.add(listing.itemId);idle.set(listing.accountId,set);
 }
 for(const [accountId,set] of idle)insights.push({id:'idle_listings:'+accountId,kind:'idle_listings',severity:'info',accountId,title:`${set.size} ${set.size===1?'anúncio ativo':'anúncios ativos'} sem venda`,detail:`Nenhuma venda nos últimos ${INSIGHT_WINDOW_DAYS} dias. Avalie preço, fotos, estoque ou pausar.`,impactCents:0,action:'ads'});

 const paid=rows.filter(row=>row.status==='paid');
 const pendingRows=paid.filter(row=>row.contributionCents===null);
 if(paid.length>=10&&pendingRows.length/paid.length>0.1){
  insights.push({id:'low_coverage',kind:'low_coverage',severity:'info',accountId:null,title:`${pendingRows.length} ${pendingRows.length===1?'venda':'vendas'} sem resultado calculado`,detail:`${percent(pendingRows.length/paid.length*100)} das vendas pagas dos últimos ${INSIGHT_WINDOW_DAYS} dias estão fora dos alertas de margem até as pendências serem resolvidas.`,impactCents:0,action:'pending'});
 }

 return insights.sort((a,b)=>severityOrder[a.severity]-severityOrder[b.severity]||b.impactCents-a.impactCents||a.id.localeCompare(b.id));
}
