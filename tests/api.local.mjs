// Requires the local dev server, migrations, and fixtures/foreign-owner.sql.
// The fixed URL and development-only cookie prevent running against production.
import {test} from 'node:test';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:5173';
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
 await t.test('origem externa ou ausente não cria conta',async()=>{
  const body=JSON.stringify({name:'Não criar'});
  assert.equal((await call('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://foreign.example'},body})).status,403);
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
