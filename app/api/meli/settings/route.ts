import {owner} from '@/lib/server';import {meli,meliError,input} from '@/lib/meli/server';
export async function POST(request:Request){try{const id=await owner(request);await meli().configure(id,await input(request));return Response.json({saved:true},{headers:{'Cache-Control':'no-store'}})}catch(e){return meliError(e)}}
