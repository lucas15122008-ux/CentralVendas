import {signAutomationHeaders,AUTOMATION_PATH} from '../../lib/meli/automation-auth.ts';
import {notificationSchema} from '../../lib/meli/jobs.ts';
import {limitedBody} from '../../lib/meli/internal.ts';
export type EventMessage={action:'event';notification:unknown}|{action:'drain'};
export type Env={EVENTS:Queue<EventMessage>;WEBHOOK_TOKEN:string;MELI_APPLICATION_ID:string;BRIDGE_SECRET:string;SITE_BEARER:string};
const SITE='https://central-vendas-lucas.kisashi.chatgpt.site';
function configured(env:Env){return !!env.WEBHOOK_TOKEN&&!!env.MELI_APPLICATION_ID&&env.BRIDGE_SECRET?.length>=32&&!!env.SITE_BEARER;}
export async function bridge(env:Env,payload:unknown){
 const body=JSON.stringify(payload),headers=await signAutomationHeaders(body,env.BRIDGE_SECRET);
 const response=await fetch(SITE+AUTOMATION_PATH,{method:'POST',headers:{...headers,'OAI-Sites-Authorization':'Bearer '+env.SITE_BEARER},body,redirect:'manual',signal:AbortSignal.timeout(75000)});
 if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('bridge_unavailable');
 const result=await response.json() as {pending?:boolean;ok?:boolean};return result;
}
export default {
 async fetch(request:Request,env:Env):Promise<Response>{
  const path=new URL(request.url).pathname;
  if(request.method==='GET'&&path==='/health')return Response.json({configured:configured(env)});
  if(!configured(env))return new Response('Unavailable',{status:503});
  if(path!=='/notifications/'+env.WEBHOOK_TOKEN)return new Response('Not found',{status:404});
  if(request.method!=='POST')return new Response('Method not allowed',{status:405});
  try{
   let data:unknown;try{data=JSON.parse(await limitedBody(request,8192));}catch{return new Response('Invalid notification',{status:400});}
   const parsed=notificationSchema.safeParse(data);
   if(!parsed.success||parsed.data.application_id!==env.MELI_APPLICATION_ID)return new Response('Invalid notification',{status:400});
   await env.EVENTS.send({action:'event',notification:parsed.data});
   return new Response('OK');
  }catch{return new Response('Try again',{status:503});}
 },
 async queue(batch:MessageBatch<EventMessage>,env:Env){
  for(const message of batch.messages){
   try{
    if(!configured(env))throw Error('unconfigured');
    if(message.body.action==='event')await bridge(env,message.body);
    const result=await bridge(env,{action:'drain'});
    if(result.pending)await env.EVENTS.send({action:'drain'},{delaySeconds:1});
    message.ack();
   }catch{message.retry({delaySeconds:Math.min(3600,30*2**Math.min(message.attempts,6))});}
  }
 },
 async scheduled(_controller:ScheduledController,env:Env){
  if(!configured(env))return;
  await bridge(env,{action:'recover'});
  await env.EVENTS.send({action:'drain'});
 }
};
