import {owner} from '@/lib/server';import {meli,meliError} from '@/lib/meli/server';
export async function GET(){try{return Response.json(await meli().status(await owner()),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return meliError(e)}}
