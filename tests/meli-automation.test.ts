import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AUTOMATION_PATH,signAutomationHeaders,verifyAutomationRequest} from '../lib/meli/automation-auth.ts';
const secret='synthetic-automation-key-not-for-production';
const now=Date.parse('2026-09-16T12:00:00Z');
const body=JSON.stringify({action:'recover'});
const request=(headers:Record<string,string>,payload=body)=>new Request('https://site.example'+AUTOMATION_PATH,{method:'POST',headers,body:payload});

test('assinatura vincula conteúdo e usa nonce uma única vez',async()=>{
 const headers=await signAutomationHeaders(body,secret,now,'n'.repeat(43));
 const nonces=new Set<string>();const claim=async(nonce:string)=>{if(nonces.has(nonce))return false;nonces.add(nonce);return true};
 assert.equal(await verifyAutomationRequest(request(headers),body,secret,claim,now),true);
 assert.equal(await verifyAutomationRequest(request(headers),body,secret,claim,now),false);
 assert.equal(await verifyAutomationRequest(request(headers,body+' '),body+' ',secret,async()=>true,now),false);
});
test('recusa segredo ausente, assinatura inválida, relógio expirado e rota diferente',async()=>{
 const headers=await signAutomationHeaders(body,secret,now,'x'.repeat(43));let claims=0;const claim=async()=>{claims++;return true};
 for(const missing of ['', 'short'])assert.equal(await verifyAutomationRequest(request(headers),body,missing,claim,now),false);
 assert.equal(await verifyAutomationRequest(request(headers),body,secret+'wrong',claim,now),false);
 assert.equal(await verifyAutomationRequest(request(headers),body,secret,claim,now+180001),false);
 assert.equal(await verifyAutomationRequest(request(headers),body,secret,claim,now-180001),false);
 assert.equal(await verifyAutomationRequest(new Request('https://site.example/api/other',{method:'POST',headers,body}),body,secret,claim,now),false);
 assert.equal(claims,0);
});
test('recusa conteúdo excessivo e nonce inválido antes de persistir',async()=>{
 const large='a'.repeat(16385);const headers=await signAutomationHeaders(large,secret,now,'a'.repeat(43));let claims=0;const claim=async()=>{claims++;return true};
 assert.equal(await verifyAutomationRequest(request(headers,large),large,secret,claim,now),false);
 const valid=await signAutomationHeaders(body,secret,now,'b'.repeat(43));valid['x-meli-automation-nonce']='bad';
 assert.equal(await verifyAutomationRequest(request(valid),body,secret,claim,now),false);assert.equal(claims,0);
});
