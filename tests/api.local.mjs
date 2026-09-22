// Requires the local dev server, migrations, and fixtures/foreign-owner.sql.
// The fixed URL and development-only cookie prevent running against production.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateSale} from '../lib/finance.ts';
const base=process.env.TEST_BASE_URL??'http://localhost:5173';
const auth={Cookie:'__sites_local_auth=1',Origin:base};
const foreignAccount='70000000-0000-4000-8000-000000000001';
const foreignImport='70000000-0000-4000-8000-000000000002';
const call=(path,options={})=>fetch(base+path,{...options,headers:{...auth,...options.headers}});
const workspace=async()=>{const r=await call('/api/workspace');assert.equal(r.status,200);return r.json()};
let accountId;
const config=()=>({accountId,validFrom:'2026-01-01',taxType:'unit',taxTreatment:'included',sheet:'Sheet1',headerRow:1,mapping:{sku:0,description:1,cost:2,tax:3}});
const csv='codigo;descricao;custo;imposto\n00001;Produto QA;10,3333;1,23\n00002;Produto sem imposto;20,00;\n';
function upload(text=csv,overrides={}){const form=new FormData();form.set('file',new File([text],'qa.csv',{type:'text/csv'}));form.set('config',JSON.stringify({...config(),...overrides}));return call('/api/imports',{method:'POST',body:form})}
test('API privada: persistência, isolamento, idempotência e histórico',async t=>{
 await t.test('sem login e cabeçalhos forjados não acessam dados',async()=>{
  assert.equal((await fetch(base+'/api/workspace')).status,401);
  assert.equal((await fetch(base+'/api/workspace',{headers:{'oai-authenticated-user-id':'local_seedy','oai-authenticated-user-email':'fake@example.test'}})).status,401);
 });
 await t.test('origem diferente ou ausente não cria conta',async()=>{
  const body=JSON.stringify({name:'Não criar'});
  // Vite allows localhost through its development CORS middleware, so this
  // mismatch reaches our API's origin check instead of testing Vite's early
  // rejection (which can leave an unread body on its keep-alive connection).
  const denied=await call('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:5173'},body});
  assert.equal(denied.status,403);
  assert.equal((await denied.json()).error,'Origem da solicitação inválida.');
  assert.equal((await fetch(base+'/api/accounts',{method:'POST',headers:{Cookie:auth.Cookie,'Content-Type':'application/json'},body})).status,403);
 });
 await t.test('cria conta de trabalho e persiste lote com precisão',async()=>{
  const r=await call('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'QA API '+crypto.randomUUID().slice(0,8)})});assert.equal(r.status,201);
  accountId=(await r.json()).id;
  const imported=await upload();assert.equal(imported.status,201);const result=await imported.json();
  const data=await workspace();const records=data.costs.filter(c=>c.accountId===accountId);
  assert.equal(records.length,2);assert.equal(records.find(c=>c.sku==='00001').unitCost,10.3333);assert.equal(records.find(c=>c.sku==='00002').taxValue,null);
  assert.equal(data.accounts.some(a=>a.id===foreignAccount),false);assert.equal(data.imports.some(i=>i.id===foreignImport),false);assert.equal(data.costs.some(c=>c.sku==='QA-FOREIGN'),false);
  const download=await call('/api/imports/'+result.id);assert.equal(download.status,200);assert.equal(await download.text(),csv);
 });
 await t.test('reenvio e concorrência não duplicam os custos',async()=>{
  const replay=await upload();assert.equal(replay.status,200);assert.equal((await replay.json()).duplicate,true);
  const concurrentCsv=csv.replace('10,3333','11,4444');
  const responses=await Promise.all([upload(concurrentCsv),upload(concurrentCsv)]);
  assert.ok(responses.every(r=>[200,201].includes(r.status)));
  const results=await Promise.all(responses.map(r=>r.json()));assert.equal(results[0].id,results[1].id);
  assert.equal((await workspace()).imports.filter(i=>i.accountId===accountId).length,2);
 });
 await t.test('linha inválida rejeita o lote inteiro',async()=>{
  const r=await upload(csv+'00003;Custo inválido;abc;0\n');assert.equal(r.status,400);
  assert.match((await r.json()).error,/Linha 4/);
  assert.equal((await workspace()).imports.filter(i=>i.accountId===accountId).length,2);
 });
 await t.test('IDs de outro proprietário não permitem baixar, retirar ou importar',async()=>{
  assert.equal((await call('/api/imports/'+foreignImport)).status,404);
  assert.equal((await call('/api/imports/'+foreignImport,{method:'DELETE'})).status,404);
  assert.equal((await upload(csv,{accountId:foreignAccount})).status,404);
 });
 await t.test('retirada preserva arquivo e reativa versões anteriores',async()=>{
  const before=await workspace();const batches=before.imports.filter(i=>i.accountId===accountId);const newest=batches[0];
  assert.equal((await call('/api/imports/'+newest.id,{method:'DELETE'})).status,200);
  const data=await workspace();const rows=data.costs.filter(c=>c.accountId===accountId);assert.equal(rows.length,2);assert.equal(rows.find(c=>c.sku==='00001').unitCost,10.3333);
  assert.ok(data.imports.find(i=>i.id===newest.id).withdrawnAt);
  assert.equal((await call('/api/imports/'+newest.id)).status,200);
  assert.equal((await upload(csv.replace('10,3333','11,4444'))).status,409);
 });
});
test('Mercado Livre: rotas privadas, configuração segura e cancelamento OAuth',async t=>{
 let account;
 const post=(path,body,headers={})=>call('/api/meli/'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 await t.test('status exige login e alterações exigem mesma origem',async()=>{
  assert.equal((await fetch(base+'/api/meli/status')).status,401);
  const denied=await post('settings',{clientId:'123',clientSecret:'local-test-secret',pkce:true},{Origin:'http://127.0.0.1:5173'});assert.equal(denied.status,403);
 });
 await t.test('salva configuração sem devolver segredo',async()=>{
  const existing=await workspace();const connections=await (await call('/api/meli/status')).json();for(const c of connections.connections){if(c.status==='authorizing'&&existing.accounts.some(a=>a.id===c.accountId&&a.name.startsWith('QA')))await post('disconnect',{accountId:c.accountId});}
  const configured=await post('settings',{clientId:'123',clientSecret:'local-test-secret',pkce:true});assert.equal(configured.status,200);
  const r=await call('/api/meli/status');assert.equal(r.status,200);const data=await r.json();assert.equal(data.app.configured,true);assert.equal(data.app.secureReady,true);assert.ok(!JSON.stringify(data).includes('local-test-secret'));
  const created=await call('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'QA conexão '+crypto.randomUUID().slice(0,6)})});account=(await created.json()).id;
 });
 await t.test('contas de outro dono não podem conectar, desconectar ou sincronizar',async()=>{for(const route of ['connect','disconnect','sync'])assert.equal((await post(route,{accountId:foreignAccount})).status,404)});
 await t.test('state usa cookie privado e recusa retorno sem vínculo',async()=>{
  const connected=await post('connect',{accountId:account});assert.equal(connected.status,200);const cookie=connected.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);const url=new URL((await connected.json()).url);assert.equal(url.origin,'https://auth.mercadolivre.com.br');assert.ok(url.searchParams.get('code_challenge'));
  const bad=await call('/api/meli/callback?state='+url.searchParams.get('state')+'&error=access_denied',{redirect:'manual'});assert.equal(bad.status,303);assert.equal(new URL(bad.headers.get('location')).searchParams.get('meli'),'error');
  const cancelled=await call('/api/meli/callback?state='+url.searchParams.get('state')+'&error=access_denied',{redirect:'manual',headers:{Cookie:auth.Cookie+'; '+cookie.split(';')[0]}});assert.equal(cancelled.status,303);assert.match(new URL(cancelled.headers.get('location')).searchParams.get('message'),/cancelada/);
  assert.equal((await post('disconnect',{accountId:account})).status,200);
  assert.equal((await post('sync',{accountId:account})).status,409);
  const data=await workspace();assert.ok(data.accounts.some(a=>a.id===account));
 });
});
test('duas autorizações simultâneas mantêm o vínculo de cada aba',async()=>{
 const cookies=[];const flows=[];
 for(let i=0;i<2;i++){const r=await call('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'QA duas abas '+crypto.randomUUID().slice(0,6)})});const id=(await r.json()).id;const flow=await call('/api/meli/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:id})});assert.equal(flow.status,200);cookies.push(flow.headers.get('set-cookie').split(';')[0]);flows.push({id,state:new URL((await flow.json()).url).searchParams.get('state')})}
 const jar=new Map(cookies.map(c=>[c.split('=')[0],c]));
 for(const f of flows){const r=await call('/api/meli/callback?state='+f.state+'&error=access_denied',{redirect:'manual',headers:{Cookie:auth.Cookie+'; '+[...jar.values()].join('; ')}});assert.match(new URL(r.headers.get('location')).searchParams.get('message'),/cancelada/);jar.delete(r.headers.get('set-cookie').split('=')[0]);await call('/api/meli/disconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:f.id})});}
});
test('fichas de anúncio: privacidade, precisão, cópia, idempotência e revisão',async()=>{
 const fixtureAccount='71000000-0000-4000-8000-000000000001';
 const fullAccount='72000000-0000-4000-8000-000000000001';
 const post=(body,headers={})=>call('/api/ad-profiles',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const first={
  action:'set',requestId:crypto.randomUUID(),accountId:fixtureAccount,itemId:'MLB-QA-1',
  variationId:'FULL',validFrom:'2026-01-01',expectedRevision:0,
  payload:{unitCostTenThousandths:0,tax:{mode:'included'},operation:'auto'},
  reason:'Custo zero confirmado para teste',
 };
 assert.equal((await fetch(base+'/api/ad-profiles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(first)})).status,401);
 assert.equal((await post(first,{Origin:'http://127.0.0.1:5173'})).status,403);
 const saved=await post(first);assert.equal(saved.status,201);const event=(await saved.json()).event;
 assert.equal(event.variationId,'FULL');assert.equal(event.payload.unitCostTenThousandths,0);assert.equal(event.revision,1);
 const replay=await post(first);assert.equal(replay.status,200);assert.equal((await replay.json()).duplicate,true);
 assert.equal((await post({...first,requestId:crypto.randomUUID()})).status,409);
 assert.equal((await post({...first,requestId:crypto.randomUUID(),variationId:''})).status,400);
 assert.equal((await post({...first,requestId:crypto.randomUUID(),payload:{...first.payload,unitCostTenThousandths:-1}})).status,400);
 assert.equal((await post({...first,requestId:crypto.randomUUID(),accountId:foreignAccount})).status,404);

 const source={
  ...first,requestId:crypto.randomUUID(),accountId:fullAccount,itemId:'MLB-QA-FULL',
  variationId:null,payload:{unitCostTenThousandths:1_000_050,tax:{mode:'unit',valueTenThousandths:12_340},operation:'full'},
 };
 const sourceSaved=await post(source);assert.equal(sourceSaved.status,201);
 const copied=await post({
  ...source,requestId:crypto.randomUUID(),itemId:'MLB-QA-COMMON',
  payload:{unitCostTenThousandths:999,tax:{mode:'included'},operation:'other'},
  copyFrom:{accountId:fullAccount,itemId:'MLB-QA-FULL',variationId:null},
 });
 assert.equal(copied.status,201);const copyEvent=(await copied.json()).event;
 assert.equal(copyEvent.payload.unitCostTenThousandths,1_000_050);
 assert.deepEqual(copyEvent.payload.tax,{mode:'unit',valueTenThousandths:12_340});
 assert.equal(copyEvent.payload.operation,'other');
 assert.equal((await post({
  ...source,requestId:crypto.randomUUID(),itemId:'MLB-QA-COMMON',expectedRevision:1,
  copyFrom:{accountId:foreignAccount,itemId:'MLB-FOREIGN',variationId:null},
 })).status,404);
});

test('correções por campo: fonte atual, fallback, revisão e isolamento',async()=>{
 const fixtureAccount='72000000-0000-4000-8000-000000000001';
 const saleId=fixtureAccount+':9101:0';
 const post=(body,headers={})=>call('/api/sale-corrections',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const current=(await workspace()).sales.find(item=>item.id===saleId);assert.ok(current?.sourceStamp);
 const override={
  action:'set',requestId:crypto.randomUUID(),accountId:fixtureAccount,saleId,
  field:'feeCents',expectedRevision:0,mode:'override',value:4900,
  sourceValue:current.feeCents,sourceStamp:current.sourceStamp,reason:'Tarifa oficial conferida no extrato',
 };
 assert.equal((await post(override,{Origin:'http://127.0.0.1:5173'})).status,403);
 const saved=await post(override);assert.equal(saved.status,201);assert.equal((await saved.json()).event.value,4900);
 const replay=await post(override);assert.equal(replay.status,200);assert.equal((await replay.json()).duplicate,true);
 assert.equal((await post({...override,requestId:crypto.randomUUID()})).status,409);
 assert.equal((await post({...override,requestId:crypto.randomUUID(),expectedRevision:1,sourceValue:4999})).status,409);
 assert.equal((await post({...override,requestId:crypto.randomUUID(),expectedRevision:1,mode:'fallback'})).status,409);
 assert.equal((await post({...override,requestId:crypto.randomUUID(),expectedRevision:1,field:'invalid'})).status,400);
 assert.equal((await post({...override,requestId:crypto.randomUUID(),expectedRevision:1,value:-1})).status,400);
 assert.equal((await post({...override,requestId:crypto.randomUUID(),expectedRevision:1,reason:''})).status,400);
 assert.equal((await post({...override,requestId:crypto.randomUUID(),expectedRevision:0,accountId:foreignAccount})).status,404);
});
test('conciliação: vínculo, ajuste, histórico, revisão e isolamento',async()=>{
 const fixtureAccount='71000000-0000-4000-8000-000000000001';
 const saleId=fixtureAccount+':9001:0';
 const post=body=>call('/api/reconciliation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let data=await workspace();let sale=data.sales.find(item=>item.id===saleId);assert.ok(sale?.sourceStamp);assert.equal(sale.saleRevision,0);
 const linkRequest=crypto.randomUUID();
 const link={kind:'product',action:'set',requestId:linkRequest,accountId:fixtureAccount,itemId:'MLB-QA-1',variationId:'FULL',validFrom:'2026-01-01',expectedRevision:0,sku:'64265',reason:'SKU conferido na planilha'};
 const linked=await post(link);assert.equal(linked.status,201);assert.equal((await linked.json()).event.revision,1);
 const replay=await post(link);assert.equal(replay.status,200);assert.equal((await replay.json()).duplicate,true);
 assert.equal((await post({...link,requestId:crypto.randomUUID(),sku:'INEXISTENTE',expectedRevision:0})).status,404);
 data=await workspace();sale=data.sales.find(item=>item.id===saleId);assert.equal(sale.costSku,'64265');assert.ok(sale.sourceStamp);
 const adjustment={kind:'sale',action:'set',requestId:crypto.randomUUID(),accountId:fixtureAccount,saleId,expectedRevision:0,sourceStamp:sale.sourceStamp,channel:'full',amounts:{revenueCents:25000,feeCents:2500,shippingCents:1000,otherCents:0,costCents:10000,taxCents:0,fullExpenseCents:1500},reason:'Venda Full conferida'};
 const adjusted=await post(adjustment);assert.equal(adjusted.status,201);
 assert.equal((await post({...adjustment,requestId:crypto.randomUUID(),expectedRevision:0})).status,409);
 data=await workspace();sale=data.sales.find(item=>item.id===saleId);assert.equal(sale.reconciliation.state,'manual');assert.equal(sale.reconciliation.amounts.fullExpenseCents,1500);assert.equal(calculateSale(sale,data.costs).contributionCents,10000);assert.equal(calculateSale(sale,data.costs).resultState,'manual');assert.equal(data.reconciliationEvents.filter(event=>event.accountId===fixtureAccount).length,2);
 const fresh=await workspace();assert.equal(calculateSale(fresh.sales.find(item=>item.id===saleId),fresh.costs).contributionCents,10000);
 const revisedCosts='codigo;descricao;custo;imposto\n64265;Radiador QA;110,00;0\n';
 const imported=await upload(revisedCosts,{accountId:fixtureAccount,validFrom:'2026-09-17'});assert.equal(imported.status,201);
 sale=(await workspace()).sales.find(item=>item.id===saleId);assert.equal(sale.reconciliation.state,'stale');
 assert.equal((await post({...adjustment,requestId:crypto.randomUUID(),expectedRevision:1})).status,409);
 assert.equal((await post({...link,requestId:crypto.randomUUID(),accountId:foreignAccount,expectedRevision:0})).status,404);
 assert.equal((await fetch(base+'/api/reconciliation',{method:'POST',headers:{Cookie:auth.Cookie,'Content-Type':'application/json'},body:JSON.stringify(link)})).status,403);
});

test('fechamento Full: prévia, rateio, revisão, conflito e rollback',async()=>{
 const fixtureAccount='72000000-0000-4000-8000-000000000001';
 const rollbackAccount='73000000-0000-4000-8000-000000000001';
 const month='2026-09';
 const postClosure=(body,headers={})=>call('/api/full-closures',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 let preview=await call(`/api/full-closures?accountId=${fixtureAccount}&month=${month}`);assert.equal(preview.status,200);
 let data=await preview.json();assert.equal(data.accountId,fixtureAccount);assert.equal(data.month,month);assert.equal(data.preview.units,2);assert.equal(data.preview.eligible.length,1);assert.equal(data.preview.excluded.length,2);assert.equal(data.latest,null);assert.equal(data.estimatedExpenseCents,null);
 const requestId=crypto.randomUUID();
 const close={action:'set',requestId,accountId:fixtureAccount,month,expectedRevision:0,totalExpenseCents:101,reason:'Demonstrativo Full setembro'};
 const saved=await postClosure(close);assert.equal(saved.status,201);let result=await saved.json();assert.equal(result.event.revision,1);assert.equal(result.event.allocations.length,1);assert.equal(result.event.allocations[0].expenseCents,101);
 const closedPreview=await call(`/api/full-closures?accountId=${fixtureAccount}&month=${month}`);assert.equal(closedPreview.status,200);assert.equal((await closedPreview.json()).estimatedExpenseCents,null);
 let projected=await workspace();let projectedSale=projected.sales.find(item=>item.id===fixtureAccount+':9101:0');assert.equal(projectedSale.fullExpense.state,'closed');assert.equal(projectedSale.fullExpense.cents,101);assert.equal(calculateSale(projectedSale,projected.costs).contributionCents,22899);assert.equal(calculateSale(projectedSale,projected.costs).resultState,'closed');assert.equal(projected.fullClosures.find(row=>row.id===result.event.id).action,'set');
 const replay=await postClosure(close);assert.equal(replay.status,200);assert.equal((await replay.json()).duplicate,true);
 assert.equal((await postClosure({...close,requestId:crypto.randomUUID()})).status,409);
 assert.equal((await call(`/api/full-closures?accountId=${foreignAccount}&month=${month}`)).status,404);
 assert.equal((await postClosure({...close,requestId:crypto.randomUUID(),accountId:foreignAccount})).status,404);
 assert.equal((await fetch(base+'/api/full-closures',{method:'POST',headers:{Cookie:auth.Cookie,'Content-Type':'application/json'},body:JSON.stringify({...close,requestId:crypto.randomUUID()})})).status,403);
 const clear=await postClosure({action:'clear',requestId:crypto.randomUUID(),accountId:fixtureAccount,month,expectedRevision:1,reason:'Reabrir para corrigir demonstrativo'});assert.equal(clear.status,201);assert.equal((await clear.json()).event.revision,2);
 preview=await call(`/api/full-closures?accountId=${fixtureAccount}&month=${month}`);data=await preview.json();assert.equal(data.latest.action,'clear');assert.equal(data.history.length,2);

 const saleId=fixtureAccount+':9101:0';const sale=(await workspace()).sales.find(item=>item.id===saleId);assert.ok(sale?.sourceStamp);
 const adjustment={kind:'sale',action:'set',requestId:crypto.randomUUID(),accountId:fixtureAccount,saleId,expectedRevision:0,sourceStamp:sale.sourceStamp,channel:'full',amounts:{revenueCents:50000,feeCents:5000,shippingCents:2000,otherCents:0,costCents:20000,taxCents:0,fullExpenseCents:50},reason:'Despesa Full individual já conferida'};
 const adjusted=await call('/api/reconciliation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(adjustment)});assert.equal(adjusted.status,201);
 const conflict=await postClosure({...close,requestId:crypto.randomUUID(),expectedRevision:2});assert.equal(conflict.status,409);assert.match((await conflict.json()).error,/individual/i);

 const failed=await postClosure({action:'set',requestId:crypto.randomUUID(),accountId:rollbackAccount,month,expectedRevision:0,totalExpenseCents:100,reason:'Forçar rollback das parcelas'});assert.equal(failed.status,500);
 const afterFailure=await call(`/api/full-closures?accountId=${rollbackAccount}&month=${month}`);assert.equal(afterFailure.status,200);assert.equal((await afterFailure.json()).history.length,0);
});
