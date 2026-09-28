import {periodStart} from './dates.ts';
import {groupProducts,summarizeSales,type CostRecord,type Sale} from './finance.ts';
import {summarizeAdvertising,type AdSpend} from './advertising.ts';
import {collectInsights} from './insights.ts';
import type {MeliListing} from './meli/catalog.ts';
import type {PendingItem} from './pending.ts';

// Read-only view of the workspace the assistant may query. Nothing here writes data.
export type AssistantData={
 accounts:{id:string;name:string}[];sales:Sale[];costs:CostRecord[];listings:MeliListing[];adSpend:AdSpend[];pending:PendingItem[];now?:Date;
};

const reais=(cents:number|null)=>cents===null?null:Math.round(cents)/100;
const pct=(value:number|null)=>value===null?null:Math.round(value*10)/10;

export function clampDays(value:unknown){const days=Math.round(Number(value));return Number.isFinite(days)?Math.min(365,Math.max(1,days)):30;}

function scope(data:AssistantData,account:string|undefined,days:number){
 const accountId=account?data.accounts.find(item=>item.id===account||item.name.toLowerCase()===account.toLowerCase())?.id??null:null;
 if(account&&!accountId)throw new Error(`Conta "${account}" não encontrada. Contas: ${data.accounts.map(item=>item.name).join(', ')}.`);
 const from=periodStart(days,data.now);
 const inAccount=<T extends {accountId:string}>(row:T)=>!accountId||row.accountId===accountId;
 return {
  accountId,from,
  sales:data.sales.filter(sale=>inAccount(sale)&&sale.date>=from),
  costs:data.costs.filter(inAccount),
  spend:data.adSpend.filter(row=>inAccount(row)&&row.date>=from),
  listings:data.listings.filter(inAccount),
 };
}

export function periodSummary(data:AssistantData,input:{dias?:number;conta?:string}){
 const days=clampDays(input.dias??30),s=scope(data,input.conta,days);
 const summary=summarizeSales(s.sales,s.costs);
 const adsCents=s.spend.reduce((sum,row)=>sum+row.costCents,0);
 return {
  periodo:{dias:days,desde:s.from},conta:s.accountId?data.accounts.find(item=>item.id===s.accountId)?.name:'todas',
  faturamento:reais(summary.grossSalesCents),receita_liquida:reais(summary.revenueCents),
  contribuicao_antes_ads:reais(summary.contributionCents),margem_percent:pct(summary.margin),
  investimento_ads:reais(adsCents),contribuicao_apos_ads:reais(summary.contributionCents-adsCents),
  cobertura_percent:pct(summary.coverage),pedidos:summary.orders,pedidos_pagos:summary.paidOrders,
  vendas_sem_resultado:summary.rows.filter(row=>row.contributionCents===null).length,
 };
}

export function productRanking(data:AssistantData,input:{dias?:number;conta?:string;ordenar?:string;limite?:number}){
 const days=clampDays(input.dias??30),s=scope(data,input.conta,days);
 const rows=summarizeSales(s.sales,s.costs).rows;
 const products=groupProducts(rows).map(product=>({
  sku:product.sku,titulo:product.title,conta:data.accounts.find(item=>item.id===product.account)?.name,unidades:product.units,
  receita:reais(product.revenue),contribuicao:product.complete?reais(product.profit):null,
  margem_percent:product.complete&&product.revenue>0?pct(product.profit/product.revenue*100):null,resultado_completo:product.complete,
 }));
 const order=input.ordenar??'contribuicao';
 const key=(row:(typeof products)[number])=>order==='receita'?row.receita??0:order==='unidades'?row.unidades:order==='prejuizo'?-(row.contribuicao??Infinity):row.contribuicao??-Infinity;
 const limit=Math.min(50,Math.max(1,Math.round(input.limite??10)));
 return {periodo:{dias:days,desde:s.from},ordenado_por:order,total_produtos:products.length,produtos:products.sort((a,b)=>key(b)-key(a)).slice(0,limit)};
}

export function advertisingReport(data:AssistantData,input:{dias?:number;conta?:string;limite?:number}){
 const days=clampDays(Math.min(30,input.dias??30)),s=scope(data,input.conta,days);
 const rows=summarizeSales(s.sales,s.costs).rows;
 const titles=new Map(s.listings.map(listing=>[listing.accountId+'\0'+listing.itemId,listing.title]));
 const ads=summarizeAdvertising(s.spend,rows,titles);
 const limit=Math.min(50,Math.max(1,Math.round(input.limite??10)));
 return {
  periodo:{dias:days,desde:s.from},investimento:reais(ads.costCents),vendas_atribuidas:reais(ads.attributedCents),acos_percent:pct(ads.acos),cliques:ads.clicks,impressoes:ads.prints,
  anuncios:ads.items.slice(0,limit).map(item=>({anuncio:item.itemId,titulo:item.title,investimento:reais(item.costCents),vendas_atribuidas:reais(item.attributedCents),acos_percent:pct(item.acos),tacos_percent:pct(item.tacos),contribuicao_antes_ads:item.complete?reais(item.contributionCents):null,contribuicao_apos_ads:reais(item.contributionAfterAdsCents),unidades_vendidas:item.units,cliques:item.clicks})),
  observacao:'Publicidade lida dos últimos 30 dias; os dois dias mais recentes ainda podem mudar.',
 };
}

export function insightList(data:AssistantData,input:{conta?:string}){
 const s=scope(data,input.conta,365);
 const insights=collectInsights({sales:data.sales.filter(sale=>!s.accountId||sale.accountId===s.accountId),costs:s.costs,listings:s.listings,adSpend:data.adSpend.filter(row=>!s.accountId||row.accountId===s.accountId),now:data.now});
 return {total:insights.length,alertas:insights.slice(0,30).map(item=>({gravidade:item.severity,tipo:item.kind,titulo:item.title,detalhe:item.detail,anuncio:item.itemId??null,impacto_estimado:reais(item.impactCents)}))};
}

export function pendingReport(data:AssistantData,input:{conta?:string}){
 const s=scope(data,input.conta,365);
 const items=data.pending.filter(item=>!s.accountId||item.accountId===s.accountId);
 const byKind:Record<string,number>={};for(const item of items)byKind[item.kind]=(byKind[item.kind]??0)+1;
 return {total:items.length,por_tipo:byKind,itens:items.slice(0,25).map(item=>({tipo:item.kind,titulo:item.title,mensagem:item.message,anuncio:item.itemId??null}))};
}

export function searchSales(data:AssistantData,input:{texto:string;dias?:number;conta?:string;limite?:number}){
 const days=clampDays(input.dias??30),s=scope(data,input.conta,days),text=input.texto.trim().toLowerCase();
 const rows=summarizeSales(s.sales,s.costs).rows.filter(row=>`${row.sku} ${row.title} ${row.orderId} ${row.itemId??''}`.toLowerCase().includes(text));
 const limit=Math.min(30,Math.max(1,Math.round(input.limite??10)));
 return {periodo:{dias:days,desde:s.from},encontradas:rows.length,vendas:rows.slice(0,limit).map(row=>({pedido:row.orderId,data:row.date,sku:row.sku,titulo:row.title,anuncio:row.itemId??null,quantidade:row.quantity,status:row.status,receita:reais(row.revenueCents),tarifa:reais(row.feeCents),frete:reais(row.shippingCents),outras_despesas:reais(row.otherCents),custo:reais(row.costCents),imposto:reais(row.taxCents),despesa_full:reais(row.fullExpenseCents),contribuicao:reais(row.contributionCents),pendencias:row.reasons}))};
}
