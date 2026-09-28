import {periodStart} from './dates.ts';
import {calculateSale,type CostRecord,type Sale} from './finance.ts';
import type {ReconciliationEvent} from './reconciliation.ts';
import type {FullClosure} from './full-reconciliation.ts';
import type {AdProfileEvent} from './ad-profiles.ts';
import type {SaleCorrectionEvent} from './sale-corrections.ts';
import type {MeliListing} from './meli/catalog.ts';
import type {PendingItem} from './pending.ts';
import type {AdSpend,AdsAccountState} from './advertising.ts';
import {collectPending} from './pending.ts';
import {projectSales} from './sale-projection.ts';

export type Account={id:string;name:string;createdAt?:string};
export type ImportBatch={id:string;accountId:string;filename:string;validFrom:string;rowCount:number;createdAt:string;withdrawnAt:string|null;config:string};
export type FullClosureSummary=Omit<FullClosure,'allocations'>&{allocationCount:number};
export type RolloutSummary={state:'pending'|'blocked'|'active';sourceStamp:string|null;activatedAt:string|null;updatedAt:string|null};
export type Workspace={
 accounts:Account[];imports:ImportBatch[];costs:CostRecord[];sales:Sale[];reconciliationEvents:ReconciliationEvent[];fullClosures:FullClosureSummary[];
 listings:MeliListing[];adProfiles:AdProfileEvent[];saleCorrections:SaleCorrectionEvent[];pending:PendingItem[];rollout:RolloutSummary;
 syncWarnings?:{accountId:string;name:string;status:string}[];
 adSpend:AdSpend[];adsStatus:AdsAccountState[];
};
export const emptyWorkspace:Workspace={accounts:[],imports:[],costs:[],sales:[],reconciliationEvents:[],fullClosures:[],listings:[],adProfiles:[],saleCorrections:[],pending:[],rollout:{state:'pending',sourceStamp:null,activatedAt:null,updatedAt:null},adSpend:[],adsStatus:[]};

export function demoWorkspace():Workspace{
 const accounts=[{id:'demo-main',name:'Loja Principal'},{id:'demo-outlet',name:'Loja Outlet'}];
 const products=[['00101','Furadeira de impacto 650W',249.9,143.5],['00102','Kit de ferramentas · 129 peças',189.9,99.6],['00103','Organizador de ferramentas',79.9,32.4],['00104','Lâmpada LED inteligente',49.9,24.8],['00105','Trena profissional · 5 m',39.9,12.9],['00106','Parafusadeira a bateria',329.9,205],['00107','Conjunto de brocas · 15 peças',59.9,21.3],['00108','Extensão elétrica · 5 m',44.9,31.5]] as const;
 const itemId=(sku:string)=>'MLB-DEMO-'+sku;
 const hasProfile=(accountId:string,sku:string)=>!(accountId==='demo-main'&&sku==='00108');
 const listings:MeliListing[]=accounts.flatMap(account=>products.map(product=>({id:JSON.stringify([account.id,itemId(product[0]),null]),accountId:account.id,itemId:itemId(product[0]),variationId:null,title:product[1],status:'active',sellerSku:product[0],updatedAt:Date.now(),hasProfile:hasProfile(account.id,product[0])})));
 const adProfiles:AdProfileEvent[]=accounts.flatMap(account=>products.filter(product=>hasProfile(account.id,product[0])).map(product=>({
  id:'demo-profile-'+account.id+'-'+product[0],accountId:account.id,itemId:itemId(product[0]),variationId:null,validFrom:'2020-01-01',revision:1,action:'set' as const,
  payload:{unitCostTenThousandths:Math.round(product[3]*10_000),tax:{mode:'percent' as const,rateBasisPoints:600},operation:product[0]==='00101'?'full' as const:'auto' as const},
  requestId:'demo-request-'+account.id+'-'+product[0],reason:'Ficha demonstrativa',origin:'native' as const,createdAt:'2026-09-01T12:00:00Z',
 })));
 const rawSales:Sale[]=[];const today=new Date();
 for(let day=29;day>=0;day--){const iso=periodStart(day+1,today);for(let n=0;n<8+(day*7)%11;n++){
  const product=products[(day*3+n)%products.length],quantity=1+(n%5===0?1:0),accountId=accounts[n%4===0?1:0].id,revenueCents=Math.round(product[2]*quantity*100);
  rawSales.push({id:'d-'+day+'-'+n,orderId:'200001'+(14020+day*23+n),accountId,sku:product[0],itemId:itemId(product[0]),variationId:null,title:product[1],date:iso,quantity,costQuantity:quantity,grossSalesCents:revenueCents,revenueCents,feeCents:Math.round(revenueCents*.135),shippingCents:product[2]>79?1280:0,otherCents:quantity*150,status:'paid',source:'mercadolivre',logisticType:product[0]==='00101'?'fulfillment':'cross_docking'});
 }}
 const base=projectSales({rawSales,legacyCosts:[],reconciliationEvents:[],profiles:adProfiles,corrections:[],closures:[],rolloutState:'active'});
 const sales=base.sales.map(sale=>sale.operation?.channel==='full'?{...sale,fullExpense:{cents:500*(sale.costQuantity??0),state:'estimated' as const,month:sale.date.slice(0,7),unitRateCents:500}}:sale);
 const pending=collectPending({sales:sales.map(sale=>calculateSale(sale,[])),listings,migrationIssues:[]});
 // Illustrative ad spend: a few listings with campaigns, one of them spending more than it returns.
 const adSpend:AdSpend[]=[];
 for(let day=29;day>=0;day--){const date=periodStart(day+1,today);for(const [index,product] of products.slice(0,4).entries()){
  const clicks=12+(day*5+index*7)%19,costCents=clicks*(index===3?95:62),attributedCents=index===3?Math.round(costCents*1.4):Math.round(product[2]*100*(1+(day+index)%3));
  adSpend.push({accountId:'demo-main',itemId:itemId(product[0]),date,costCents,clicks,prints:clicks*38,attributedCents,attributedUnits:Math.max(1,Math.round(attributedCents/(product[2]*100)))});
 }}
 const adsStatus:AdsAccountState[]=[{accountId:'demo-main',state:'active',error:null,checkedAt:Date.now(),lastFetchedAt:Date.now()},{accountId:'demo-outlet',state:'no_advertiser',error:null,checkedAt:Date.now(),lastFetchedAt:null}];
 return {adSpend,adsStatus,accounts,costs:[],sales,imports:[],reconciliationEvents:[],fullClosures:[],listings,adProfiles,saleCorrections:[],pending,rollout:{state:'active',sourceStamp:'demo',activatedAt:'2026-09-01T12:00:00Z',updatedAt:'2026-09-01T12:00:00Z'}};
}
