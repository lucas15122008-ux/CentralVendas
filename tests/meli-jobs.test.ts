import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,order} from './helpers/meli.ts';
import {MeliJobs} from '../lib/meli/jobs.ts';
const notice={application_id:123,user_id:456,topic:'orders_v2',resource:'/orders/100'};
test('avisos duplicados convergem e vendedor ou recurso estranho não entra na fila',async()=>{
 const x=setup();await x.authorize();const jobs=new MeliJobs(x.service);
 await jobs.enqueueNotification(notice);await jobs.enqueueNotification(notice);
 assert.equal(x.sqlite.prepare('SELECT count(*) n FROM meli_jobs').get()?.n,1);
 await assert.rejects(jobs.enqueueNotification({...notice,resource:'https://evil.test/orders/100'}));
 assert.equal(await jobs.enqueueNotification({...notice,user_id:999}),false);
});
test('venda aparece antes do enriquecimento e falha deixa trabalho recuperável',async()=>{
 const x=setup();await x.authorize();const jobs=new MeliJobs(x.service);await jobs.enqueueNotification(notice);let fail=true;
 x.setHandler(async url=>{if(url.pathname==='/orders/100')return Response.json({...order(),shipping:null});
  assert.equal(url.pathname,'/orders/100/discounts');assert.equal(x.sqlite.prepare('SELECT count(*) n FROM meli_orders').get()?.n,1);
  return fail?new Response(null,{status:503}):Response.json({details:[]});});
 await jobs.processNext();let row=x.sqlite.prepare('SELECT data FROM meli_orders').get();assert.equal(JSON.parse(String(row?.data))[0].revenueCents,null);
 assert.equal(x.sqlite.prepare('SELECT attempts FROM meli_jobs').get()?.attempts,1);
 fail=false;x.advance(120000);await jobs.processNext();row=x.sqlite.prepare('SELECT data FROM meli_orders').get();assert.equal(JSON.parse(String(row?.data))[0].revenueCents,10000);
 assert.equal(x.sqlite.prepare('SELECT count(*) n FROM meli_jobs').get()?.n,0);
});
test('aviso durante processamento não desaparece com confirmação anterior',async()=>{
 const x=setup();await x.authorize();const jobs=new MeliJobs(x.service);await jobs.enqueueNotification(notice);let again=true;
 x.setHandler(async url=>{if(url.pathname==='/orders/100')return Response.json({...order(),shipping:null});if(again){again=false;await jobs.enqueueNotification(notice);}return Response.json({details:[]});});
 await jobs.processNext();assert.equal(x.sqlite.prepare('SELECT count(*) n FROM meli_jobs').get()?.n,1);
 await jobs.processNext();assert.equal(x.sqlite.prepare('SELECT count(*) n FROM meli_jobs').get()?.n,0);
});
test('evento divide trava com sincronização manual e desconexão impede escrita tardia',async()=>{
 const x=setup();await x.authorize();const jobs=new MeliJobs(x.service);await jobs.enqueueNotification(notice);
 x.setHandler(async()=>{await assert.rejects(x.service.sync('owner','a'));await x.service.disconnect('owner','a');return Response.json({...order(),shipping:null})});
 await jobs.processNext();assert.equal(x.sqlite.prepare('SELECT count(*) n FROM meli_orders').get()?.n,0);
});
test('recuperação agenda contas conectadas sem duplicar nem ressuscitar geração antiga',async()=>{
 const x=setup();await x.authorize();const jobs=new MeliJobs(x.service);await jobs.recover();await jobs.recover();assert.equal(x.sqlite.prepare('SELECT count(*) n FROM meli_jobs').get()?.n,1);
 await x.service.disconnect('owner','a');await jobs.processNext();assert.equal(x.sqlite.prepare('SELECT count(*) n FROM meli_jobs').get()?.n,0);
});

test('estado automático depende de contato real e sinaliza atraso e recuperação',async()=>{
 const x=setup();await x.authorize();const jobs=new MeliJobs(x.service);
 assert.equal((await x.service.status('owner',true)).automation.state,'pending');
 await jobs.recover();assert.equal((await x.service.status('owner',true)).automation.state,'active');
 x.setHandler(async()=>new Response(null,{status:429}));await jobs.processNext();assert.equal((await x.service.status('owner',true)).automation.state,'retrying');
 x.advance(181000);assert.equal((await x.service.status('owner',true)).automation.state,'lagging');
 assert.equal((await x.service.status('other',true)).automation.pending,0);
});
test('falha de revisão antiga não atrasa um aviso novo',async()=>{
 const x=setup();await x.authorize();const jobs=new MeliJobs(x.service);await jobs.enqueueNotification(notice);x.sqlite.exec('UPDATE meli_jobs SET attempts=7');
 let notify=true;x.setHandler(async()=>{if(notify){notify=false;await jobs.enqueueNotification(notice);return new Response(null,{status:503});}return Response.json({...order(),shipping:null});});
 const result=await jobs.processNext();assert.equal(result.pending,true);assert.equal(x.sqlite.prepare('SELECT attempts FROM meli_jobs').get()?.attempts,0);
});

test('último aviso é separado do contato periódico e isolado por proprietário',async()=>{
 const x=setup();await x.authorize();const jobs=new MeliJobs(x.service);await jobs.recover();
 assert.equal((await x.service.status('owner',true)).automation.lastEventAt,null);
 await jobs.enqueueNotification(notice);assert.equal(typeof (await x.service.status('owner',true)).automation.lastEventAt,'number');
 assert.equal((await x.service.status('other',true)).automation.lastEventAt,null);
});
