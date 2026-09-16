import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './helpers/meli.ts';
import {signAutomationHeaders} from '../lib/meli/automation-auth.ts';
import {handleAutomationRequest} from '../lib/meli/internal.ts';
const secret='test-only-automation-secret-at-least-32';
test('ponte exige assinatura e não aceita repetição nem ação arbitrária',async()=>{
 const x=setup();await x.authorize();const body=JSON.stringify({action:'recover'});
 assert.equal((await handleAutomationRequest(new Request('https://site.test/api/meli/internal',{method:'POST',body}),x.service,secret)).status,401);
 assert.equal(x.sqlite.prepare('SELECT count(*) n FROM meli_jobs').get()?.n,0);
 const headers=await signAutomationHeaders(body,secret);const request=()=>new Request('https://site.test/api/meli/internal',{method:'POST',body,headers});
 assert.equal((await handleAutomationRequest(request(),x.service,secret)).status,200);
 assert.equal((await handleAutomationRequest(request(),x.service,secret)).status,401);
 assert.equal(x.sqlite.prepare('SELECT count(*) n FROM meli_jobs').get()?.n,1);
 const bad=JSON.stringify({action:'delete'});assert.equal((await handleAutomationRequest(new Request('https://site.test/api/meli/internal',{method:'POST',body:bad,headers:await signAutomationHeaders(bad,secret)}),x.service,secret)).status,400);
});
