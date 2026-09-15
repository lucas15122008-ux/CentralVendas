import {owner} from '@/lib/server';import {meli,meliError,input,accountId} from '@/lib/meli/server';
export async function POST(request:Request){try{const id=await owner(request);const body=await input(request);await meli().disconnect(id,accountId(body.accountId));return Response.json({disconnected:true},{headers:{'Cache-Control':'no-store'}})}catch(e){return meliError(e)}}
