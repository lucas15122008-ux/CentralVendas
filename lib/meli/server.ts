import {env} from 'cloudflare:workers';
import {database,errorResponse} from '../server';
import {MeliService,MeliError} from './service';
export function meli(){return new MeliService(database(),env.MELI_ENCRYPTION_KEY??'');}
export function meliError(error:unknown){if(error instanceof MeliError)return Response.json({error:error.message},{status:error.status,headers:{'Cache-Control':'private, no-store'}});return errorResponse(error);}
export async function input(request:Request){if(Number(request.headers.get('content-length')??0)>8000)throw new MeliError(413,'Solicitação muito grande.');try{const text=await request.text();if(text.length>8000)throw Error();return JSON.parse(text)}catch{throw new MeliError(400,'Solicitação inválida.');}}
export function accountId(value:unknown){if(typeof value!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(value))throw new MeliError(400,'Selecione uma conta válida.');return value;}
