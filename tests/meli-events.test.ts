import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/meli-events/worker.ts';
const event={application_id:123,user_id:456,topic:'orders_v2',resource:'/orders/100'};
const make=(send:(body:unknown)=>Promise<unknown>)=>({EVENTS:{send},WEBHOOK_TOKEN:'synthetic-hook',MELI_APPLICATION_ID:'123',BRIDGE_SECRET:'synthetic-bridge-secret-long-enough',SITE_BEARER:'synthetic-site-token'}) as never;
test('webhook só confirma após persistir e recusa aplicação/recurso inválido',async()=>{
 const messages:unknown[]=[];const env=make(async body=>{messages.push(body)});const request=(body:unknown)=>new Request('https://events.test/notifications/synthetic-hook',{method:'POST',body:JSON.stringify(body)});
 assert.equal((await worker.fetch(request(event),env)).status,200);assert.equal(messages.length,1);
 assert.equal((await worker.fetch(request({...event,application_id:999}),env)).status,400);
 assert.equal((await worker.fetch(request({...event,resource:'https://evil.test'}),env)).status,400);
 assert.equal((await worker.fetch(request(event),make(async()=>{throw Error('queue unavailable')}))).status,503);
});
