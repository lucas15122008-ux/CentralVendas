import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {verifyAutomationRequest} from '../lib/meli/automation-auth.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const secret='test-only-bridge-secret-long-enough';
for(const redirect of [false,true])test(redirect?'ponte no Worker rejeita redirecionamento e mantém aviso para repetir':'ponte no Worker assina, confirma o aviso e agenda continuação',async()=>{
 const bundle=await build({stdin:{contents:`import worker from './workers/meli-events/worker.ts';export default {async fetch(){const sent=[];let ack=false,retry=false;const env={WEBHOOK_TOKEN:'synthetic',MELI_APPLICATION_ID:'123',BRIDGE_SECRET:${JSON.stringify(secret)},SITE_BEARER:'synthetic-bearer',EVENTS:{async send(value){sent.push(value)}}};await worker.queue({messages:[{body:{action:'event',notification:{application_id:'123',user_id:'456',topic:'orders_v2',resource:'/orders/100'}},attempts:1,ack(){ack=true},retry(){retry=true}}]},env);return Response.json({sent,ack,retry})}}`,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
 const calls=[];const worker=new Miniflare({modules:true,compatibilityDate:'2026-05-15',script:bundle.outputFiles[0].text,outboundService:async request=>{
  assert.equal(request.url,'https://central-vendas-lucas.kisashi.chatgpt.site/api/meli/internal');assert.equal(request.headers.get('authorization'),'Bearer synthetic-bearer');
  const body=await request.text();assert.equal(await verifyAutomationRequest(new Request(request.url,{method:'POST',headers:request.headers,body}),body,secret,async()=>true),true);calls.push(JSON.parse(body));
  return redirect?new Response(null,{status:302,headers:{Location:'https://evil.test'}}):Response.json({pending:true});
 }});
 try{const result=await(await worker.dispatchFetch('https://local.test')).json();assert.equal(result.ack,!redirect);assert.equal(result.retry,redirect);assert.equal(result.sent.length,redirect?0:1);assert.equal(calls.length,redirect?1:2);}finally{await worker.dispose();}
});
