import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeAdRows,parseAdsPage,parseAdvertiser,pendingAdsDays} from '../lib/meli/ads.ts';
import {summarizeAdvertising} from '../lib/advertising.ts';
import {calculateSale,type Sale} from '../lib/finance.ts';
import {setup} from './helpers/meli.ts';
import {MeliJobs} from '../lib/meli/jobs.ts';

const page=(results:unknown[],total=results.length)=>({paging:{total,offset:0,limit:50},results});
const ad=(item_id:string,cost:number,extra:Record<string,number>={})=>({item_id,campaign_id:1,status:'active',metrics:{clicks:10,prints:300,cost,direct_amount:50,indirect_amount:25,direct_units_quantity:1,indirect_units_quantity:1,...extra}});

test('leitura do Mercado Ads converte métricas em centavos e soma anúncios do mesmo item',()=>{
 const parsed=parseAdsPage(page([ad('MLB1',12.345),ad('MLB1',1,{total_amount:10}),ad('MLB2',0,{clicks:0,prints:0,direct_amount:0,indirect_amount:0,direct_units_quantity:0,indirect_units_quantity:0})]));
 assert.equal(parsed.total,3);
 assert.deepEqual(parsed.rows[0],{itemId:'MLB1',costCents:1235,clicks:10,prints:300,attributedCents:7500,attributedUnits:2});
 assert.equal(parsed.rows[1].attributedCents,1000);
 assert.deepEqual(mergeAdRows(parsed.rows),[{itemId:'MLB1',costCents:1335,clicks:20,prints:600,attributedCents:8500,attributedUnits:4}]);
 assert.throws(()=>parseAdsPage({results:[]}));
});

test('anunciante do Brasil é escolhido e ausência vira nulo',()=>{
 assert.equal(parseAdvertiser({advertisers:[{advertiser_id:9,site_id:'MLA'},{advertiser_id:7,site_id:'MLB'}]}),'7');
 assert.equal(parseAdvertiser({advertisers:[]}),null);
});

test('dias recentes são relidos até fechar e dias fechados não voltam à fila',()=>{
 const now=Date.parse('2026-09-15T15:00:00Z');
 assert.equal(pendingAdsDays([],now).length,30);
 const days=[
  {date:'2026-09-01',fetchedAt:Date.parse('2026-09-10T12:00:00Z')},
  {date:'2026-09-14',fetchedAt:now-2*3600000},
  {date:'2026-09-15',fetchedAt:now-60000},
 ];
 const pending=pendingAdsDays(days,now);
 assert.ok(!pending.includes('2026-09-01'));
 assert.ok(pending.includes('2026-09-14'));
 assert.ok(!pending.includes('2026-09-15'));
 assert.equal(pending.at(-1),'2026-09-14');
});

test('investimento é descontado por anúncio sem mudar a contribuição da venda',()=>{
 const sale:Sale={id:'s1',orderId:'1',accountId:'a',sku:'X',title:'Produto',date:'2026-09-14',quantity:2,costQuantity:2,revenueCents:20000,feeCents:2000,shippingCents:0,otherCents:0,status:'paid',itemId:'MLB1',operation:{channel:'other',source:'meli'},adProfile:{eventId:'e',revision:1,validFrom:'2026-01-01',unitCostTenThousandths:500000,tax:{mode:'included'}}};
 const row=calculateSale(sale,[]);
 assert.equal(row.contributionCents,8000);
 const summary=summarizeAdvertising([{accountId:'a',itemId:'MLB1',date:'2026-09-14',costCents:3000,clicks:40,prints:900,attributedCents:15000,attributedUnits:1},{accountId:'a',itemId:'MLB9',date:'2026-09-14',costCents:500,clicks:5,prints:80,attributedCents:0,attributedUnits:0}],[row],new Map([['a\0MLB9','Sem venda']]));
 assert.equal(summary.costCents,3500);
 assert.equal(summary.items[0].contributionAfterAdsCents,5000);
 assert.equal(summary.items[0].acos,20);
 assert.equal(summary.items[0].tacos,15);
 assert.equal(summary.items[1].title,'Sem venda');
 assert.equal(summary.items[1].contributionAfterAdsCents,-500);
 assert.equal(summary.items[1].acos,null);
});

test('sincronização de publicidade grava gasto diário e fecha a fila',async()=>{
 const x=setup();await x.authorize();const seen:{path:string;version:string|null}[]=[];
 x.setHandler(async(url,init)=>{
  seen.push({path:url.pathname,version:new Headers(init?.headers).get('Api-Version')});
  if(url.pathname==='/advertising/advertisers')return Response.json({advertisers:[{advertiser_id:77,site_id:'MLB'}]});
  if(url.pathname==='/advertising/MLB/advertisers/77/product_ads/ads/search'){
   const date=url.searchParams.get('date_from');assert.equal(url.searchParams.get('date_to'),date);
   return Response.json(date==='2026-09-14'?page([ad('MLB1',5)]):page([]));
  }
  throw Error(url.pathname);
 });
 let result=await x.service.syncAds('owner','a');
 while(result.status!=='complete')result=await x.service.syncAds('owner','a');
 assert.equal(result.state,'active');
 assert.equal(seen[0].version,'1');assert.equal(seen[1].version,'2');
 assert.equal(x.sqlite.prepare('SELECT count(*) n FROM meli_ads_days').get()?.n,30);
 const row=x.sqlite.prepare('SELECT item_id,date,cost_cents,attributed_cents FROM meli_ad_spend').get();
 assert.deepEqual({...row},{item_id:'MLB1',date:'2026-09-14',cost_cents:500,attributed_cents:7500});
 const calls=seen.length;await x.service.syncAds('owner','a');assert.equal(seen.length,calls);
 x.advance(3600001);await x.service.syncAds('owner','a');
 assert.ok(seen.length>calls&&seen.length<=calls+3);
 assert.equal(x.sqlite.prepare('SELECT count(*) n FROM meli_ad_spend').get()?.n,1);
});

test('aplicação sem permissão de publicidade fica sinalizada sem travar a fila',async()=>{
 const x=setup();await x.authorize();
 x.setHandler(async()=>Response.json({error:'forbidden'},{status:403}));
 const result=await x.service.syncAds('owner','a');
 assert.deepEqual({status:result.status,state:result.state},{status:'complete',state:'forbidden'});
 assert.equal(x.sqlite.prepare('SELECT state FROM meli_ads_state').get()?.state,'forbidden');
 const jobs=new MeliJobs(x.service);await jobs.recover();
 assert.equal(x.sqlite.prepare("SELECT count(*) n FROM meli_jobs WHERE resource='ads'").get()?.n,0);
});

test('fila automática agenda e conclui a leitura da publicidade',async()=>{
 const x=setup();await x.authorize();const jobs=new MeliJobs(x.service);await jobs.recover();
 assert.equal(x.sqlite.prepare("SELECT count(*) n FROM meli_jobs WHERE resource='ads'").get()?.n,1);
 x.sqlite.exec("DELETE FROM meli_jobs WHERE resource<>'ads'");
 x.setHandler(async url=>{
  if(url.pathname==='/advertising/advertisers')return Response.json({advertisers:[]});
  throw Error(url.pathname);
 });
 await jobs.processNext();
 assert.equal(x.sqlite.prepare("SELECT count(*) n FROM meli_jobs WHERE resource='ads'").get()?.n,0);
 assert.equal(x.sqlite.prepare('SELECT state FROM meli_ads_state').get()?.state,'no_advertiser');
 await jobs.recover();
 assert.equal(x.sqlite.prepare("SELECT count(*) n FROM meli_jobs WHERE resource='ads'").get()?.n,0);
});
