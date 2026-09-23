import {z} from 'zod';
import {remoteId} from './protocol.ts';

export type MeliListing={
 id:string;
 accountId:string;
 itemId:string;
 variationId:string|null;
 title:string;
 status:string;
 sellerSku:string|null;
 updatedAt:number;
 hasProfile?:boolean;
};

const attribute=z.object({id:z.string(),value_name:z.string().nullish()});
const variation=z.object({
 id:remoteId,
 seller_custom_field:z.string().nullish(),
 attributes:z.array(attribute).default([]),
});
const item=z.object({
 id:z.string().min(1).max(100),
 seller_id:remoteId,
 title:z.string().min(1).max(1000),
 status:z.string().min(1).max(80),
 last_updated:z.string().refine(value=>!Number.isNaN(Date.parse(value))),
 seller_custom_field:z.string().nullish(),
 attributes:z.array(attribute).default([]),
 variations:z.array(variation).max(500).default([]),
});
const searchSchema=z.object({
 seller_id:remoteId,
 paging:z.object({total:z.number().int().nonnegative(),offset:z.number().int().nonnegative(),limit:z.number().int().positive()}),
 results:z.array(z.string().min(1).max(100)).max(50),
});
const bulkEntry=z.object({id:z.string().min(1).max(100),status_code:z.number().int(),body:z.unknown().optional()});

function sku(attributes:z.infer<typeof attribute>[],fallback:string|null|undefined){
 return attributes.find(value=>value.id==='SELLER_SKU')?.value_name?.trim()||fallback?.trim()||null;
}

export function parseCatalogPage(searchInput:unknown,itemsInput:unknown,accountId:string):MeliListing[]{
 const search=searchSchema.parse(searchInput);
 const entries=z.array(bulkEntry).max(50).parse(itemsInput);
 if(new Set(search.results).size!==search.results.length||entries.length!==search.results.length)throw new Error('Catálogo incompleto.');
 const byId=new Map(entries.map(entry=>[entry.id,entry]));
 if(byId.size!==entries.length||search.results.some(id=>!byId.has(id)))throw new Error('Catálogo inconsistente.');
 const listings:MeliListing[]=[];
 for(const expectedId of search.results){
  const entry=byId.get(expectedId)!;
  if(entry.status_code===403||entry.status_code===404)continue;
  if(entry.status_code!==200)throw new Error('Detalhe do anúncio indisponível temporariamente.');
  const body=item.parse(entry.body);
  if(body.id!==expectedId||body.seller_id!==search.seller_id)throw new Error('Anúncio de outro vendedor.');
  const updatedAt=Date.parse(body.last_updated);
  if(body.variations.length){
   for(const row of body.variations){
    listings.push({
     id:JSON.stringify([accountId,body.id,row.id]),
     accountId,itemId:body.id,variationId:row.id,title:body.title,status:body.status,
     sellerSku:sku(row.attributes,row.seller_custom_field),updatedAt,
    });
   }
  }else{
   listings.push({
    id:JSON.stringify([accountId,body.id,null]),
    accountId,itemId:body.id,variationId:null,title:body.title,status:body.status,
    sellerSku:sku(body.attributes,body.seller_custom_field),updatedAt,
   });
  }
 }
 return listings;
}
