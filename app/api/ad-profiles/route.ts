import {z} from 'zod';
import {latestAdProfile,type AdProfilePayload} from '@/lib/ad-profiles';
import {loadAdProfiles,saveAdProfile} from '@/lib/ad-profile-store';
import type {Sale} from '@/lib/finance';
import {database,errorResponse,HttpError,owner} from '@/lib/server';

const requestId=z.string().uuid();
const accountId=z.string().uuid();
const itemId=z.string().trim().min(1).max(80);
const variationId=z.string().trim().min(1).max(80).nullable().optional();
const revision=z.number().int().min(0).max(1_000_000);
const reason=z.string().trim().min(3).max(240);
const validDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);
const amount=z.number().int().min(0).max(1_000_000_000_000);
const tax=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('included')}),
 z.object({mode:z.literal('unit'),valueTenThousandths:amount}),
 z.object({mode:z.literal('percent'),rateBasisPoints:z.number().int().min(0).max(10_000)}),
]);
const payload=z.object({unitCostTenThousandths:amount,tax,operation:z.enum(['auto','full','other'])});
const copyFrom=z.object({accountId,itemId,variationId});
const base={requestId,accountId,itemId,variationId,validFrom:validDate,expectedRevision:revision,reason};
const inputSchema=z.union([
 z.object({...base,action:z.literal('set'),payload,copyFrom:copyFrom.optional()}),
 z.object({...base,action:z.literal('clear')}),
]);

async function accountExists(db:D1Database,user:string,id:string){
 return !!await db.prepare('SELECT id FROM accounts WHERE id=? AND owner_id=?').bind(id,user).first();
}

async function targetExists(db:D1Database,user:string,account:string,item:string,variation:string|null){
 const normalized=variation??'';
 const listing=await db.prepare('SELECT id FROM meli_listings WHERE owner_id=? AND account_id=? AND item_id=? AND variation_id=?')
  .bind(user,account,item,normalized).first();
 if(listing)return true;
 const rows=await db.prepare('SELECT data FROM meli_orders WHERE owner_id=? AND account_id=?').bind(user,account).all<{data:string}>();
 return rows.results.some(row=>{
  try{return (JSON.parse(row.data) as Sale[]).some(sale=>sale.itemId===item&&(sale.variationId??null)===variation);}
  catch{return false;}
 });
}

export async function POST(request:Request){try{
 const user=await owner(request);
 let body:unknown;try{body=await request.json();}catch{throw new HttpError(400,'Dados da ficha inválidos.');}
 const parsed=inputSchema.safeParse(body);
 if(!parsed.success)throw new HttpError(400,'Revise o anúncio, os valores, a vigência e o motivo.');
 const input=parsed.data,db=database(),variation=input.variationId??null;
 if(!await accountExists(db,user,input.accountId))throw new HttpError(404,'Conta não encontrada.');
 if(!await targetExists(db,user,input.accountId,input.itemId,variation))throw new HttpError(404,'Anúncio ou variação não encontrado nesta conta.');
 let resolvedPayload:AdProfilePayload|null=input.action==='set'?input.payload:null;
 if(input.action==='set'&&input.copyFrom){
  if(input.copyFrom.accountId!==input.accountId)throw new HttpError(404,'A ficha de origem não pertence a esta conta.');
  const sourceVariation=input.copyFrom.variationId??null;
  if(!await targetExists(db,user,input.accountId,input.copyFrom.itemId,sourceVariation))throw new HttpError(404,'Ficha de origem não encontrada nesta conta.');
  const source=latestAdProfile(await loadAdProfiles(db,user),input.accountId,input.copyFrom.itemId,sourceVariation);
  if(!source?.payload)throw new HttpError(404,'Ficha de origem não encontrada nesta conta.');
  resolvedPayload={unitCostTenThousandths:source.payload.unitCostTenThousandths,tax:source.payload.tax,operation:input.payload.operation};
 }
 const saved=await saveAdProfile(db,user,{action:input.action,requestId:input.requestId,accountId:input.accountId,itemId:input.itemId,variationId:variation,validFrom:input.validFrom,expectedRevision:input.expectedRevision,payload:resolvedPayload,reason:input.reason,origin:'native'});
 return Response.json(saved,{status:saved.duplicate?200:201});
 }catch(error){return errorResponse(error);}
}
