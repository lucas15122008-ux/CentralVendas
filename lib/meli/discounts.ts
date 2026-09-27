import {z} from 'zod';
import type {MeliOrder} from './protocol.ts';
import {remoteId} from './protocol.ts';

export type SellerDiscountSummary={
 sellerCentsByLine:number[];
 hasDiscounts:boolean;
};

const amount=z.number().finite().nonnegative().max(1e10);
const discountResponse=z.object({
 details:z.array(z.object({
  type:z.string().min(1).max(80),
  items:z.array(z.object({
   id:z.string().min(1).max(100),
   variation_id:remoteId.nullish(),
   quantity:z.number().positive().max(1e6),
   amounts:z.object({total:amount,seller:amount}),
  })).min(1).max(100),
 })).max(100),
});

export function hasNoPromotionEvidence(order:MeliOrder):boolean{
 if(order.tags?.some(tag=>/discount|coupon|cashback|promotion|promo/i.test(tag)))return false;
 if(order.payments?.some(payment=>(payment.coupon_amount??0)>0))return false;
 return order.order_items.every(line=>
  line.unit_price!=null&&line.gross_price!=null&&
  Math.round(line.gross_price*100)===Math.round(line.unit_price*line.quantity*100)&&
  (line.full_unit_price==null||Math.round(line.full_unit_price*100)===Math.round(line.unit_price*100))&&
  !line.discounts?.length
 );
}

export function parseSellerDiscounts(order:MeliOrder,input:unknown):SellerDiscountSummary|null{
 const parsed=discountResponse.safeParse(input);
 if(!parsed.success)return null;
 const sellerCentsByLine=order.order_items.map(()=>0);
 for(const detail of parsed.data.details){
  for(const item of detail.items){
   if(item.amounts.seller>item.amounts.total)return null;
   const matches=order.order_items.map((line,index)=>({line,index})).filter(({line})=>
    line.item.id===item.id&&
    (item.variation_id==null||(line.item.variation_id??null)===item.variation_id)
   );
   if(matches.length!==1||item.quantity>matches[0].line.quantity)return null;
   sellerCentsByLine[matches[0].index]+=Math.round(item.amounts.seller*100);
  }
 }
 return {sellerCentsByLine,hasDiscounts:parsed.data.details.length>0};
}
