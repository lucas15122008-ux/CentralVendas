import {env} from 'cloudflare:workers';
import Anthropic from '@anthropic-ai/sdk';
import {owner,database,errorResponse,HttpError} from '@/lib/server';
import {loadWorkspace} from '@/lib/workspace-data';
import {askAssistant,chatSchema} from '@/lib/assistant';

export async function POST(request:Request){try{
 const id=await owner(request);
 if(!env.ANTHROPIC_API_KEY)throw new HttpError(503,'O agente de IA ainda não foi configurado. Cadastre a chave ANTHROPIC_API_KEY no Site.');
 if(Number(request.headers.get('content-length')??0)>100000)throw new HttpError(413,'Conversa muito longa. Comece uma nova.');
 let body:unknown;try{body=await request.json();}catch{throw new HttpError(400,'Solicitação inválida.');}
 const parsed=chatSchema.safeParse(body);if(!parsed.success)throw new HttpError(400,'Mensagem inválida ou conversa muito longa. Comece uma nova conversa.');
 const workspace=await loadWorkspace(database(),id);
 try{
  const reply=await askAssistant(env.ANTHROPIC_API_KEY,{accounts:workspace.accounts,sales:workspace.sales,costs:workspace.costs,listings:workspace.listings,adSpend:workspace.adSpend,pending:workspace.pending},parsed.data.messages);
  return Response.json({reply},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){
  if(error instanceof Anthropic.AuthenticationError)throw new HttpError(503,'A chave do agente de IA foi recusada. Confira ANTHROPIC_API_KEY.');
  if(error instanceof Anthropic.RateLimitError)throw new HttpError(429,'O agente recebeu muitas perguntas seguidas. Tente em instantes.');
  if(error instanceof Anthropic.APIError){console.error('assistant_upstream_error',{status:error.status});throw new HttpError(502,'O agente de IA não respondeu. Tente novamente.');}
  throw error;
 }
}catch(error){return errorResponse(error)}}
