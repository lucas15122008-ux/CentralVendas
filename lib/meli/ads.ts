import {z} from 'zod';
import {remoteId} from './protocol.ts';
import {businessDate} from '../dates.ts';

// Mercado Ads keeps settling clicks for a couple of days, so recent days are read again until they close.
export const ADS_HISTORY_DAYS=30;
export const ADS_SETTLE_DAYS=2;
export const ADS_REFRESH_MS=3600000;
export const ADS_PAGE_LIMIT=50;
export const ADS_METRICS='clicks,prints,cost,direct_amount,indirect_amount,total_amount,direct_units_quantity,indirect_units_quantity';

export type AdSpendRow={itemId:string;costCents:number;clicks:number;prints:number;attributedCents:number;attributedUnits:number};
export type AdsDayState={date:string;fetchedAt:number};

const count=z.number().finite().nonnegative().max(1e12).nullish();
const advertisersSchema=z.object({advertisers:z.array(z.object({advertiser_id:remoteId,site_id:z.string().max(10).nullish()}).passthrough()).max(50)});
const adsPageSchema=z.object({
 paging:z.object({total:z.number().int().nonnegative(),offset:z.number().int().nonnegative().optional(),limit:z.number().int().positive().optional()}).passthrough(),
 results:z.array(z.object({
  item_id:z.string().min(1).max(100),
  metrics:z.object({clicks:count,prints:count,cost:count,direct_amount:count,indirect_amount:count,total_amount:count,direct_units_quantity:count,indirect_units_quantity:count}).passthrough().nullish(),
 }).passthrough()).max(ADS_PAGE_LIMIT),
});

export function parseAdvertiser(input:unknown):string|null{
 const parsed=advertisersSchema.parse(input);
 return parsed.advertisers.find(row=>!row.site_id||row.site_id==='MLB')?.advertiser_id??null;
}

export function parseAdsPage(input:unknown):{total:number;rows:AdSpendRow[]}{
 const parsed=adsPageSchema.parse(input);
 const cents=(value:number|null|undefined)=>Math.round((value??0)*100);
 const rows=parsed.results.map(result=>{
  const m=result.metrics??{};
  return {
   itemId:result.item_id,
   costCents:cents(m.cost),
   clicks:Math.round(m.clicks??0),
   prints:Math.round(m.prints??0),
   attributedCents:m.total_amount!=null?cents(m.total_amount):cents(m.direct_amount)+cents(m.indirect_amount),
   attributedUnits:Math.round((m.direct_units_quantity??0)+(m.indirect_units_quantity??0)),
  };
 });
 return {total:parsed.paging.total,rows};
}

// Several ads can point to the same item (one per campaign); the margin only needs the item total.
export function mergeAdRows(rows:AdSpendRow[]):AdSpendRow[]{
 const byItem=new Map<string,AdSpendRow>();
 for(const row of rows){
  const saved=byItem.get(row.itemId);
  if(!saved){byItem.set(row.itemId,{...row});continue;}
  saved.costCents+=row.costCents;saved.clicks+=row.clicks;saved.prints+=row.prints;saved.attributedCents+=row.attributedCents;saved.attributedUnits+=row.attributedUnits;
 }
 return [...byItem.values()].filter(row=>row.costCents>0||row.clicks>0||row.prints>0||row.attributedCents>0);
}

function addDays(date:string,days:number){
 const value=new Date(date+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);
}

// A day is final once it was read after its settlement window; until then it is read again every hour.
export function pendingAdsDays(days:AdsDayState[],now:number,historyDays=ADS_HISTORY_DAYS):string[]{
 const today=businessDate(new Date(now));
 const fetched=new Map(days.map(day=>[day.date,day.fetchedAt]));
 const pending:string[]=[];
 for(let back=historyDays-1;back>=0;back--){
  const date=addDays(today,-back);
  const fetchedAt=fetched.get(date);
  if(fetchedAt===undefined){pending.push(date);continue;}
  const final=businessDate(new Date(fetchedAt))>addDays(date,ADS_SETTLE_DAYS);
  if(!final&&fetchedAt<now-ADS_REFRESH_MS)pending.push(date);
 }
 return pending;
}
