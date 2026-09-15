// Run in workerd, not Node: native fetch validates its receiver in production.
// Outbound HTTP is intercepted locally; no credentials or provider calls are used.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('cliente Mercado Livre usa o fetch nativo do Worker com o receptor correto',async()=>{
 const bundle=await build({stdin:{contents:`import {MeliService} from './lib/meli/service.ts';
 export default {async fetch(){const client=new MeliService({},'');try{return Response.json(await client.remote('/oauth/token',undefined,new URLSearchParams({grant_type:'authorization_code',code:'synthetic-code',client_secret:'synthetic-secret'})))}catch(e){return Response.json({error:e.message},{status:502})}}};`,resolveDir:root,sourcefile:'meli-worker-test.ts',loader:'ts'},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
 const worker=new Miniflare({modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],script:bundle.outputFiles[0].text,outboundService:async request=>{
  assert.equal(request.url,'https://api.mercadolibre.com/oauth/token');assert.equal(request.method,'POST');const body=new URLSearchParams(await request.text());assert.equal(body.get('grant_type'),'authorization_code');assert.equal(body.get('code'),'synthetic-code');
  return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:21600,user_id:456});
 }});
 try{const response=await worker.dispatchFetch('http://local.test');const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.access_token,'synthetic-access');}finally{await worker.dispose()}
});
test('redirecionamento do provedor é recusado sem encaminhar o código OAuth',async()=>{
 const bundle=await build({stdin:{contents:`import {MeliService} from './lib/meli/service.ts';export default {async fetch(){try{await new MeliService({},'').remote('/oauth/token',undefined,new URLSearchParams({code:'synthetic-code'}));return new Response('unexpected success')}catch(e){return new Response(e.message,{status:502})}}}`,resolveDir:root,sourcefile:'meli-redirect-test.ts',loader:'ts'},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
 const destinations=[];
 const worker=new Miniflare({modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],script:bundle.outputFiles[0].text,outboundService:async request=>{destinations.push(request.url);return new Response(null,{status:302,headers:{Location:'https://redirect-target.example/collect'}})}});
 try{const response=await worker.dispatchFetch('http://local.test');assert.equal(response.status,502);await response.text();assert.deepEqual(destinations,['https://api.mercadolibre.com/oauth/token']);}finally{await worker.dispose()}
});
