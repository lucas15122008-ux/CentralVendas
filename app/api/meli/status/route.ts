import {env} from 'cloudflare:workers';
import {owner} from '@/lib/server';import {meli,meliError} from '@/lib/meli/server';
export async function GET(){try{return Response.json(await meli().status(await owner(),(env.MELI_AUTOMATION_SECRET?.length??0)>=32),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return meliError(e)}}
