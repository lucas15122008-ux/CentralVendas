import {z} from 'zod';
import {businessDate} from '../dates.ts';
import type {Sale} from '../finance.ts';
import {allocateCents} from '../allocation.ts';
import type {SellerDiscountSummary} from './discounts.ts';
export {allocateCents} from '../allocation.ts';
export const remoteId=z.union([z.string().regex(/^\d+$/),z.number().int().nonnegative().safe()]).transform(String);
const amount=z.number().finite().nonnegative().max(1e10);
const itemSchema=z.object({id:z.string().min(1).max(100),title:z.string().max(1000),variation_id:remoteId.nullish(),seller_sku:z.string().nullish(),seller_custom_field:z.string().nullish()});
export const orderSchema=z.object({id:remoteId,seller:z.object({id:remoteId}),status:z.string(),date_created:z.string().refine(s=>!Number.isNaN(Date.parse(s))),currency_id:z.literal('BRL'),order_items:z.array(z.object({item:itemSchema,quantity:z.number().positive().max(1e6),unit_price:amount.nullish(),sale_fee:amount.nullish(),full_unit_price:amount.nullish(),gross_price:amount.nullish(),discounts:z.array(z.unknown()).nullish()})).min(1).max(100),shipping:z.object({id:remoteId.nullish()}).nullish(),tags:z.array(z.string()).optional(),payments:z.array(z.object({status:z.string().optional(),coupon_amount:amount.nullish(),transaction_amount_refunded:amount.nullish(),amount_refunded:amount.nullish()})).optional()});
export type MeliOrder=z.infer<typeof orderSchema>;
export type ShipmentCost={id:string;sellerCostCents:number|null;orderIds:string[];complete:boolean;logisticType:string|null};
export function authorizationUrl(config:{clientId:string;redirectUri:string;pkce:boolean},state:string,challenge:string){const url=new URL('https://auth.mercadolivre.com.br/authorization');url.search=new URLSearchParams({response_type:'code',client_id:config.clientId,redirect_uri:config.redirectUri,state,...(config.pkce?{code_challenge:challenge,code_challenge_method:'S256'}:{})}).toString();return url.toString();}
export function normalizeOrders(accountId:string,sellerId:string,input:unknown[],shipments:ShipmentCost[],discountState:Map<string,SellerDiscountSummary|null>=new Map()):Sale[]{
 const orders=input.map(o=>orderSchema.parse(o));if(orders.some(o=>o.seller.id!==sellerId))throw Error('Pedido de outro vendedor.');
 const shipmentById=new Map(shipments.map(shipment=>[shipment.id,shipment]));
 const rows:Sale[]=[];
 for(const order of orders){
  const refunded=['cancelled','partially_refunded','pending_cancel'].includes(order.status)||order.payments?.some(p=>(p.transaction_amount_refunded??p.amount_refunded??0)>0||p.status==='refunded'||p.status==='charged_back');
  const status:Sale['status']=refunded?'refunded':order.status==='paid'?'paid':order.status==='cancelled'?'cancelled':'pending';
  const discountSummary=discountState.get(order.id);
  const discountChecked=discountState.has(order.id);
  const discountUnknown=discountChecked&&discountSummary===null;
  const legacyDiscount=!discountChecked&&(order.tags?.some(tag=>/discount|coupon|cashback|partially_refunded/.test(tag))||order.payments?.some(p=>(p.coupon_amount??0)>0)||order.order_items.some(l=>(l.discounts?.length??0)>0||(l.unit_price!=null&&((l.full_unit_price??l.unit_price)>l.unit_price||Math.round((l.gross_price??l.unit_price*l.quantity)*100)>Math.round(l.unit_price*l.quantity*100)))));
  const logisticType=order.shipping?.id?shipmentById.get(order.shipping.id)?.logisticType??null:null;
  order.order_items.forEach((line,index)=>{
   const sku=line.item.seller_sku?.trim()||line.item.seller_custom_field?.trim();const issues:string[]=[];
   if(!sku)issues.push('Anúncio sem SKU: informe o código no Mercado Livre e atualize as vendas.');
   if(refunded)issues.push('Cancelamento ou reembolso: receita e recuperação do estoque a conciliar.');
   if(discountUnknown)issues.push('Descontos e subsídios ainda não confirmados pelo Mercado Livre.');
   if(legacyDiscount)issues.push('Descontos e subsídios promocionais a conciliar.');
   rows.push({id:`${accountId}:${order.id}:${index}`,orderId:order.id,accountId,sku:sku??`Sem SKU · ${line.item.id}/${line.item.variation_id??'0'}`,title:line.item.title,date:businessDate(new Date(order.date_created)),quantity:line.quantity,costQuantity:refunded?null:line.quantity,grossSalesCents:status==='paid'&&line.unit_price!=null?Math.round(line.unit_price*line.quantity*100):null,revenueCents:refunded||discountUnknown||legacyDiscount||line.unit_price==null?null:Math.round(line.unit_price*line.quantity*100),feeCents:line.sale_fee==null?null:Math.round(line.sale_fee*line.quantity*100),shippingCents:null,otherCents:discountUnknown||legacyDiscount?null:discountSummary?.sellerCentsByLine[index]??0,status,source:'mercadolivre',sourceIssues:issues,itemId:line.item.id,variationId:line.item.variation_id??null,logisticType});
  });
 }
 for(const shipment of shipments){
  const included=orders.filter(o=>o.shipping?.id===shipment.id);
  const ids=new Set(included.map(o=>o.id));
  if(!shipment.complete||shipment.sellerCostCents===null||!shipment.orderIds.length||shipment.orderIds.some(id=>!ids.has(id))||included.some(o=>!shipment.orderIds.includes(o.id)))continue;
  if(included.some(o=>o.order_items.some(l=>l.unit_price==null)))continue;
  const group=rows.filter(r=>ids.has(r.orderId));const weights=group.map(r=>{const o=included.find(o=>o.id===r.orderId)!;const index=Number(r.id.split(':').at(-1));return Math.round(o.order_items[index].unit_price!*o.order_items[index].quantity*100)});
  if(!weights.some(w=>w>0)&&shipment.sellerCostCents!==0)continue;
  allocateCents(shipment.sellerCostCents,weights).forEach((value,i)=>{group[i].shippingCents=value});
 }
 return rows;
}

export function browserCookie(state:string){return /^[A-Za-z0-9_-]{43}$/.test(state)?'meli_'+state:'meli_invalid';}
