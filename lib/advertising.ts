import type {SaleResult} from './finance.ts';

export type AdSpend={accountId:string;itemId:string;date:string;costCents:number;clicks:number;prints:number;attributedCents:number;attributedUnits:number};
export type AdsAccountState={accountId:string;state:'active'|'no_advertiser'|'forbidden'|'error';error:string|null;checkedAt:number;lastFetchedAt:number|null};
export type AdItemSummary={
 accountId:string;itemId:string;title:string;
 costCents:number;clicks:number;prints:number;attributedCents:number;attributedUnits:number;
 revenueCents:number;units:number;contributionCents:number;complete:boolean;
 contributionAfterAdsCents:number|null;acos:number|null;tacos:number|null;
};

const ratio=(part:number,whole:number)=>whole>0?part/whole*100:null;

// Ads are charged per listing and per day, not per order, so they are deducted at listing and period level.
export function summarizeAdvertising(spend:AdSpend[],rows:SaleResult[],titles:Map<string,string>=new Map()){
 const items=new Map<string,AdItemSummary>();
 const key=(accountId:string,itemId:string)=>accountId+'\0'+itemId;
 const item=(accountId:string,itemId:string)=>{
  const id=key(accountId,itemId);
  let saved=items.get(id);
  if(!saved){saved={accountId,itemId,title:titles.get(id)??itemId,costCents:0,clicks:0,prints:0,attributedCents:0,attributedUnits:0,revenueCents:0,units:0,contributionCents:0,complete:true,contributionAfterAdsCents:null,acos:null,tacos:null};items.set(id,saved);}
  return saved;
 };
 for(const row of spend){
  const target=item(row.accountId,row.itemId);
  target.costCents+=row.costCents;target.clicks+=row.clicks;target.prints+=row.prints;target.attributedCents+=row.attributedCents;target.attributedUnits+=row.attributedUnits;
 }
 const advertised=new Set(items.keys());
 for(const row of rows){
  if(!row.itemId||!advertised.has(key(row.accountId,row.itemId)))continue;
  const target=item(row.accountId,row.itemId);
  if(target.title===target.itemId)target.title=row.title;
  target.revenueCents+=row.revenueCents??0;target.units+=row.quantity;target.contributionCents+=row.contributionCents??0;target.complete&&=row.contributionCents!==null;
 }
 for(const target of items.values()){
  target.contributionAfterAdsCents=target.complete?target.contributionCents-target.costCents:null;
  target.acos=ratio(target.costCents,target.attributedCents);
  target.tacos=ratio(target.costCents,target.revenueCents);
 }
 const list=[...items.values()].sort((a,b)=>b.costCents-a.costCents);
 const total=list.reduce((sum,row)=>({costCents:sum.costCents+row.costCents,clicks:sum.clicks+row.clicks,prints:sum.prints+row.prints,attributedCents:sum.attributedCents+row.attributedCents}),{costCents:0,clicks:0,prints:0,attributedCents:0});
 return {...total,acos:ratio(total.costCents,total.attributedCents),items:list};
}
