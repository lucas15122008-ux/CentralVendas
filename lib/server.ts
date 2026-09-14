import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
export class HttpError extends Error { status:number;constructor(status:number,message:string){super(message);this.status=status;} }
export async function owner(request?:Request){const user=await getChatGPTUser();if(!user)throw new HttpError(401,'Entre na sua conta para salvar seus dados.');if(request&&request.method!=='GET'){const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin)throw new HttpError(403,'Origem da solicitação inválida.');}return user.userId;}
export function database(){if(!env.DB)throw new HttpError(503,'O armazenamento está indisponível. Tente novamente.');return env.DB;}
export function bucket(){if(!env.BUCKET)throw new HttpError(503,'O armazenamento de arquivos está indisponível. Tente novamente.');return env.BUCKET;}
export function errorResponse(error:unknown){if(error instanceof HttpError)return Response.json({error:error.message},{status:error.status});console.error('storage_operation_failed',error instanceof Error?error.name:'unknown');return Response.json({error:'Não foi possível concluir. Seus dados na tela foram preservados; tente novamente.'},{status:500});}
export async function digest(value:ArrayBuffer|string){const data=typeof value==='string'?new TextEncoder().encode(value):value;const hash=await crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');}
