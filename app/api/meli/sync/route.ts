import {owner} from '@/lib/server';import {meli,meliError,input,accountId} from '@/lib/meli/server';
export async function POST(request:Request){try{const id=await owner(request);const body=await input(request);return Response.json(await meli().sync(id,accountId(body.accountId)),{headers:{'Cache-Control':'no-store'}})}catch(e){return meliError(e)}}
