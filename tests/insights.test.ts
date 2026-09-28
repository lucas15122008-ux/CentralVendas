import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectInsights} from '../lib/insights.ts';
import type {Sale} from '../lib/finance.ts';
import type {MeliListing} from '../lib/meli/catalog.ts';

const now=new Date('2026-09-28T15:00:00Z');
let n=0;
function sale(itemId:string,date:string,revenueCents:number,unitCost:number,extra:Partial<Sale>={}):Sale{
 n++;
 return {id:'s'+n,orderId:String(n),accountId:'a',sku:itemId,title:'Produto '+itemId,date,quantity:1,costQuantity:1,grossSalesCents:revenueCents,revenueCents,feeCents:Math.round(revenueCents*.1),shippingCents:0,otherCents:0,status:'paid',itemId,operation:{channel:'other',source:'meli'},adProfile:{eventId:'e',revision:1,validFrom:'2026-01-01',unitCostTenThousandths:unitCost*100,tax:{mode:'included'}},...extra};
}
const listing=(itemId:string,status='active'):MeliListing=>({id:itemId,accountId:'a',itemId,variationId:null,title:'Anúncio '+itemId,status,sellerSku:null,updatedAt:0});

test('insights apontam prejuízo, Ads que consome a margem e Ads sem venda',()=>{
 const sales=[sale('NEG','2026-09-20',10000,9500),sale('ADS','2026-09-20',10000,5000),sale('OK','2026-09-20',10000,5000)];
 const adSpend=[
  {accountId:'a',itemId:'ADS',date:'2026-09-20',costCents:5000,clicks:80,prints:2000,attributedCents:10000,attributedUnits:1},
  {accountId:'a',itemId:'DEAD',date:'2026-09-20',costCents:1500,clicks:30,prints:900,attributedCents:0,attributedUnits:0},
 ];
 const insights=collectInsights({sales,costs:[],listings:[listing('NEG'),listing('ADS'),listing('OK'),listing('DEAD')],adSpend,now});
 const kinds=insights.map(item=>item.kind+':'+(item.itemId??''));
 assert.deepEqual(kinds.slice(0,2).sort(),['ads_eat_margin:ADS','negative_listing:NEG']);
 assert.ok(kinds.includes('ads_without_sales:DEAD'));
 assert.ok(!kinds.some(kind=>kind.endsWith(':OK')));
 assert.equal(insights.find(item=>item.kind==='ads_eat_margin')?.impactCents,1000);
 assert.equal(insights.find(item=>item.kind==='idle_listings')?.title,'1 anúncio ativo sem venda');
});

test('queda semanal exige volume anterior e ignora oscilação pequena',()=>{
 const sales=[
  ...['2026-09-15','2026-09-16','2026-09-17'].map(date=>sale('DROP','2026-09-'+date.slice(8),20000,5000)),
  sale('DROP','2026-09-25',10000,5000),
  sale('STEADY','2026-09-16',20000,5000),sale('STEADY','2026-09-17',20000,5000),sale('STEADY','2026-09-25',30000,5000),
  sale('SMALL','2026-09-16',10000,5000),
 ];
 const insights=collectInsights({sales,costs:[],listings:[],adSpend:[],now});
 const drops=insights.filter(item=>item.kind==='sales_drop').map(item=>item.itemId);
 assert.deepEqual(drops,['DROP']);
 assert.match(insights.find(item=>item.kind==='sales_drop')!.detail,/queda de 83%/);
});

test('venda sem resultado completo nunca vira alerta de margem',()=>{
 const sales=[sale('PEND','2026-09-20',10000,9900,{feeCents:null}),sale('PEND','2026-09-21',10000,9900,{feeCents:null}),...Array.from({length:9},()=>sale('OK','2026-09-20',10000,5000))];
 const insights=collectInsights({sales,costs:[],listings:[],adSpend:[],now});
 assert.ok(!insights.some(item=>item.itemId==='PEND'));
 assert.equal(insights.find(item=>item.kind==='low_coverage')?.title,'2 vendas sem resultado calculado');
});

test('margem baixa positiva vira atenção, não crítico',()=>{
 const insights=collectInsights({sales:[sale('THIN','2026-09-20',10000,8700)],costs:[],listings:[],adSpend:[],now});
 assert.deepEqual(insights.map(item=>[item.kind,item.severity]),[['low_margin','warning']]);
});
