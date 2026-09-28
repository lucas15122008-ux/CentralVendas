import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,order} from './helpers/meli.ts';

test('configuração e states são privados e não expõem segredos',async()=>{const x=setup();await x.configure();const status=await x.service.status('owner');assert.equal(status.app.configured,true);assert.ok(!JSON.stringify(status).includes('secret-example'));assert.equal((await x.service.status('other')).app.configured,false);await assert.rejects(x.service.connect('owner','b'));const f=await x.service.connect('owner','a');await assert.rejects(x.service.callback('other',f.state,f.browser,'code'));await assert.rejects(x.service.callback('owner',f.state,'wrong-browser','code'));await x.service.callback('owner',f.state,f.browser,'code');await assert.rejects(x.service.callback('owner',f.state,f.browser,'code'));});
test('autorização expirada não conecta',async()=>{const x=setup();await x.configure();const f=await x.service.connect('owner','a');x.advance(601000);await assert.rejects(x.service.callback('owner',f.state,f.browser,'code'));assert.notEqual((await x.service.status('owner')).connections[0].status,'connected');});
test('desconectar durante OAuth impede resposta tardia de restaurar tokens',async()=>{const x=setup();await x.configure();const f=await x.service.connect('owner','a');x.setHandler(async url=>{if(url.pathname.endsWith('/discounts'))return Response.json({details:[]});if(url.pathname==='/oauth/token'){await x.service.disconnect('owner','a');return Response.json({access_token:'a',refresh_token:'r',expires_in:21600,user_id:456,token_type:'bearer'})}return Response.json({id:456,nickname:'LOJA',site_id:'MLB'})});await assert.rejects(x.service.callback('owner',f.state,f.browser,'code'));const c=x.sqlite.prepare('SELECT status,tokens FROM meli_connections').get();assert.equal(c?.status,'disconnected');assert.equal(c?.tokens,null);});
test('conta existente não troca de vendedor após desconectar',async()=>{const x=setup();await x.authorize();await x.service.disconnect('owner','a');const flow=await x.service.connect('owner','a');x.setHandler(async url=>Response.json(url.pathname==='/oauth/token'?{access_token:'a',refresh_token:'r',expires_in:21600,user_id:999,token_type:'bearer'}:{id:999,nickname:'OUTRA',site_id:'MLB'}));await assert.rejects(x.service.callback('owner',flow.state,flow.browser,'code'));assert.equal(x.sqlite.prepare('SELECT seller_id FROM meli_connections').get()?.seller_id,'456');});
test('refresh incerto não reutiliza token após expirar a trava',async()=>{const x=setup();await x.authorize();x.advance(21600000);x.setHandler(async()=>{throw Error('Resposta perdida')});await assert.rejects(x.service.accessToken('owner','a'));x.advance(120000);await assert.rejects(x.service.accessToken('owner','a'));assert.equal((await x.service.status('owner')).connections[0].status,'reconnect');});
test('refresh interrompido exige reconexão e não reenvia a tentativa',async()=>{const x=setup();await x.authorize();x.sqlite.prepare("UPDATE meli_connections SET status='refreshing',refresh_started=?").run(1);await assert.rejects(x.service.accessToken('owner','a'));assert.equal((await x.service.status('owner')).connections[0].status,'reconnect');});
test('desconectar durante refresh também impede restauração tardia',async()=>{const x=setup();await x.authorize();x.advance(21600000);x.setHandler(async()=>{await x.service.disconnect('owner','a');return Response.json({access_token:'new',refresh_token:'new-r',expires_in:21600,user_id:456,token_type:'bearer'})});await assert.rejects(x.service.accessToken('owner','a'));assert.equal(x.sqlite.prepare('SELECT tokens FROM meli_connections').get()?.tokens,null);});


test('sync pagina, salva carrinho inteiro e não duplica ao repetir',async()=>{const x=setup();await x.authorize();x.setHandler(async url=>{if(url.pathname.endsWith('/discounts'))return Response.json({details:[]});if(url.pathname==='/orders/search')return Response.json({paging:{total:1,offset:0,limit:5},results:[order()]});if(url.pathname==='/orders/101')return Response.json(order(101,200));if(url.pathname==='/shipments/789')return Response.json({id:789,logistic:{type:'drop_off'}});if(url.pathname==='/shipments/789/items')return Response.json([{order_id:100,sender_id:456,item_id:'MLB123',quantity:1},{order_id:101,sender_id:456,item_id:'MLB123',quantity:1}]);if(url.pathname==='/shipments/789/costs')return Response.json({senders:[{user_id:456,cost:10}]});throw Error(url.pathname)});const result=await x.service.sync('owner','a');assert.equal(result.status,'complete');const rows=x.sqlite.prepare('SELECT data FROM meli_orders ORDER BY order_id').all();assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>JSON.parse(String(r.data))[0].shippingCents),[333,667]);await x.service.sync('owner','a');assert.equal(x.sqlite.prepare('SELECT count(*) AS n FROM meli_orders').get()?.n,2);});
test('sync preserva o tipo logístico oficial do envio',async()=>{
 const x=setup();await x.authorize();let detailCalls=0;
 x.setHandler(async url=>{
  if(url.pathname.endsWith('/discounts'))return Response.json({details:[]});
  if(url.pathname==='/orders/search')return Response.json({paging:{total:1,offset:0,limit:5},results:[order()]});
  if(url.pathname==='/shipments/789'){detailCalls++;return Response.json({id:789,logistic:{type:'fulfillment'}})}
  if(url.pathname.endsWith('/items'))return Response.json([{order_id:100,sender_id:456,item_id:'MLB123',variation_id:null,quantity:1}]);
  if(url.pathname.endsWith('/costs'))return Response.json({senders:[{user_id:456,cost:10}]});
  throw Error(url.pathname);
 });
 await x.service.sync('owner','a');
 const sale=JSON.parse(String(x.sqlite.prepare('SELECT data FROM meli_orders').get()?.data))[0];
 assert.equal(detailCalls,1);assert.equal(sale.logisticType,'fulfillment');assert.equal(sale.shippingCents,1000);
});
test('detalhe logístico proibido não impede salvar os demais dados do envio',async()=>{
 const x=setup();await x.authorize();let detailCalls=0;
 x.setHandler(async url=>{
  if(url.pathname.endsWith('/discounts'))return Response.json({details:[]});
  if(url.pathname==='/orders/search')return Response.json({paging:{total:1,offset:0,limit:5},results:[order()]});
  if(url.pathname==='/shipments/789'){detailCalls++;return new Response(null,{status:403})}
  if(url.pathname.endsWith('/items'))return Response.json([{order_id:100,sender_id:456,item_id:'MLB123',variation_id:null,quantity:1}]);
  if(url.pathname.endsWith('/costs'))return Response.json({senders:[{user_id:456,cost:10}]});
  throw Error(url.pathname);
 });
 await x.service.sync('owner','a');
 const sale=JSON.parse(String(x.sqlite.prepare('SELECT data FROM meli_orders').get()?.data))[0];
 assert.equal(detailCalls,1);assert.equal(sale.logisticType,null);assert.equal(sale.shippingCents,1000);
});
test('outra aba não atualiza durante um lote e desconexão invalida a gravação',async()=>{const x=setup();await x.authorize();x.setHandler(async url=>{if(url.pathname.endsWith('/discounts'))return Response.json({details:[]});if(url.pathname==='/orders/search'){await assert.rejects(x.service.sync('owner','a'));await x.service.disconnect('owner','a');return Response.json({paging:{total:1,offset:0,limit:5},results:[{...order(),shipping:null}]})}throw Error(url.pathname)});await assert.rejects(x.service.sync('owner','a'));assert.equal(x.sqlite.prepare('SELECT count(*) AS n FROM meli_orders').get()?.n,0);});
test('erro remoto não vaza tokens nem resposta do provedor',async()=>{const x=setup();await x.authorize();x.setHandler(async()=>new Response('access refresh private-data',{status:403}));await assert.rejects(x.service.sync('owner','a'),e=>e instanceof Error&&!/private-data|access refresh/.test(e.message));});
test('páginas distintas persistem progresso sem repetir a primeira página',async()=>{const x=setup();await x.authorize();x.setHandler(async url=>{if(url.pathname.endsWith('/discounts'))return Response.json({details:[]});assert.equal(url.pathname,'/orders/search');assert.equal(url.searchParams.get('seller'),'456');assert.equal(url.searchParams.has('order.status'),false);const offset=Number(url.searchParams.get('offset'));return Response.json({paging:{total:6,offset,limit:5},results:(offset===0?[100,101,102,103,104]:[105]).map(id=>({...order(id),shipping:null}))});});const first=await x.service.sync('owner','a');assert.equal(first.status,'running');assert.equal(first.processed,5);const last=await x.service.sync('owner','a');assert.equal(last.status,'complete');assert.equal(last.processed,6);assert.equal(x.sqlite.prepare('SELECT count(*) AS n FROM meli_orders').get()?.n,6);});
test('falha ao salvar um membro do frete reverte o lote inteiro',async()=>{const x=setup();await x.authorize();x.sqlite.exec("CREATE TRIGGER fail_second BEFORE INSERT ON meli_orders WHEN NEW.order_id='101' BEGIN SELECT RAISE(ABORT,'storage failure'); END");x.setHandler(async url=>{if(url.pathname.endsWith('/discounts'))return Response.json({details:[]});if(url.pathname==='/orders/search')return Response.json({paging:{total:2,offset:0},results:[order(),order(101,200)]});if(url.pathname==='/shipments/789')return Response.json({id:789,logistic:{type:'drop_off'}});if(url.pathname.endsWith('/items'))return Response.json([{order_id:100,sender_id:456,item_id:'MLB123',variation_id:null,quantity:1},{order_id:101,sender_id:456,item_id:'MLB123',variation_id:null,quantity:1}]);return Response.json({senders:[{user_id:456,cost:10}]})});await assert.rejects(x.service.sync('owner','a'));assert.equal(x.sqlite.prepare('SELECT count(*) AS n FROM meli_orders').get()?.n,0);assert.equal(x.sqlite.prepare('SELECT offset FROM meli_sync_runs').get()?.offset,0);assert.equal(x.sqlite.prepare('SELECT synced_at FROM meli_connections').get()?.synced_at,null);});
test('configuração não troca enquanto há autorização ativa',async()=>{const x=setup();await x.authorize();await assert.rejects(x.service.configure('owner',{clientId:'999',clientSecret:'replacement',pkce:false}));assert.equal((await x.service.status('owner')).app.clientId,'123');});
test('erro 401 exige reconexão e mantém os pedidos já importados',async()=>{const x=setup();await x.authorize();x.setHandler(async()=>new Response(null,{status:401}));await assert.rejects(x.service.sync('owner','a'));assert.equal((await x.service.status('owner')).connections[0].status,'reconnect');});
test('frete com apenas parte das unidades fica pendente',async()=>{const x=setup();await x.authorize();x.setHandler(async url=>{if(url.pathname.endsWith('/discounts'))return Response.json({details:[]});if(url.pathname==='/orders/search')return Response.json({paging:{total:1,offset:0},results:[{...order(),order_items:[{...order().order_items[0],quantity:2}]}]});if(url.pathname==='/shipments/789')return Response.json({id:789,logistic:{type:'drop_off'}});if(url.pathname.endsWith('/items'))return Response.json([{order_id:100,sender_id:456,item_id:'MLB123',variation_id:null,quantity:1}]);if(url.pathname.endsWith('/discounts'))return Response.json({details:[]});return Response.json({senders:[{user_id:456,cost:10}]})});await x.service.sync('owner','a');assert.equal(JSON.parse(String(x.sqlite.prepare('SELECT data FROM meli_orders').get()?.data))[0].shippingCents,null);});
test('sem detalhe de descontos, promoção de preço confirma zero e só cupom fica pendente',async()=>{
 const x=setup();await x.authorize();
 const plain={...order(100),shipping:null,order_items:[{...order().order_items[0],gross_price:100,discounts:[]}]};
 const promoted={...order(101),shipping:null,order_items:[{...order().order_items[0],gross_price:120,discounts:[{amounts:{full:20,seller:5}}]}]};
 const otherError={...order(102),shipping:null,order_items:[{...order().order_items[0],gross_price:100,discounts:[]}]};
 const coupon={...order(103),shipping:null,payments:[{status:'approved',coupon_amount:10}]};
 x.setHandler(async url=>{
  if(url.pathname==='/orders/search')return Response.json({paging:{total:4,offset:0,limit:5},results:[plain,promoted,otherError,coupon]});
  if(url.pathname.endsWith('/discounts'))return Response.json({error:url.pathname.includes('/102/')?'not_found':'discount_not_found'},{status:404});
  throw Error(url.pathname);
 });
 await x.service.sync('owner','a');
 const rows=x.sqlite.prepare('SELECT order_id,data FROM meli_orders ORDER BY order_id').all().map(row=>JSON.parse(String(row.data))[0]);
 assert.deepEqual(rows.map(row=>[row.revenueCents,row.otherCents]),[[10000,0],[10000,0],[10000,0],[10000,null]]);
});

test('descontos de campanha são consultados mesmo sem sinal no pedido',async()=>{const x=setup();await x.authorize();x.setHandler(async url=>{if(url.pathname==='/orders/search')return Response.json({paging:{total:1,offset:0},results:[{...order(),shipping:null}]});if(url.pathname.endsWith('/discounts'))return Response.json({details:[{type:'cashback',items:[{id:'MLB123',quantity:1,amounts:{total:5,seller:0}}]}]});throw Error(url.pathname)});await x.service.sync('owner','a');const saved=JSON.parse(String(x.sqlite.prepare('SELECT data FROM meli_orders').get()?.data))[0];assert.equal(saved.revenueCents,10000);assert.equal(saved.otherCents,0);});
test('parcela de desconto do vendedor vira despesa sem incluir subsídio',async()=>{
 const x=setup();await x.authorize();
 x.setHandler(async url=>{
  if(url.pathname==='/orders/search')return Response.json({paging:{total:1,offset:0},results:[{...order(),shipping:null}]});
  if(url.pathname.endsWith('/discounts'))return Response.json({details:[{type:'coupon',items:[{id:'MLB123',quantity:1,amounts:{total:8,seller:3}}]}]});
  throw Error(url.pathname);
 });
 await x.service.sync('owner','a');const saved=JSON.parse(String(x.sqlite.prepare('SELECT data FROM meli_orders').get()?.data))[0];
 assert.equal(saved.revenueCents,10000);assert.equal(saved.otherCents,300);
});
test('erro do provedor registra diagnóstico sem tokens ou parâmetros privados',async()=>{
 const x=setup();const logs:unknown[][]=[];const original=console.error;console.error=(...args)=>{logs.push(args)};
 x.setHandler(async()=>Response.json({error:'invalid_limit',message:'Invalid limit; secret-token-example',access_token:'secret-token-example',buyer:{email:'private@example.test'}},{status:400}));
 try{await assert.rejects(x.service.remote('/orders/search?seller=123&access_token=secret-token-example','secret-token-example'));}finally{console.error=original;}
 assert.equal(logs.length,1);const diagnostic=logs[0][1] as Record<string,unknown>;assert.equal(diagnostic.status,400);assert.equal(diagnostic.resource,'/orders/search');assert.equal(diagnostic.code,'invalid_limit');assert.ok(!JSON.stringify(logs).includes('secret-token-example'));assert.ok(!JSON.stringify(logs).includes('private@example.test'));assert.ok(!JSON.stringify(logs).includes('seller=123'));
});
test('busca do vendedor não envia status inválidos e preserva cancelamentos',async()=>{
 const x=setup();await x.authorize();
 x.setHandler(async url=>{
  if(url.pathname.endsWith('/discounts'))return Response.json({details:[]});
  assert.equal(url.pathname,'/orders/search');
  if(url.searchParams.get('order.status')?.split(',').includes('partially_paid'))return Response.json({error:'bad_request',message:'Invalid filters: [partially_paid]'},{status:400});
  assert.equal(url.searchParams.has('order.status'),false);assert.equal(url.searchParams.get('seller'),'456');
  assert.equal(url.searchParams.get('order.date_created.from'),'2026-08-16T15:00:00.000Z');assert.equal(url.searchParams.get('order.date_created.to'),'2026-09-15T16:00:00.000Z');
  return Response.json({paging:{total:2,offset:0,limit:5},results:[{...order(),shipping:null},{...order(101),status:'cancelled',shipping:null}]});
 });
 const result=await x.service.sync('owner','a');assert.equal(result.status,'complete');assert.equal(result.processed,2);
 const saved=x.sqlite.prepare('SELECT data FROM meli_orders ORDER BY order_id').all().map(r=>JSON.parse(String(r.data))[0]);
 assert.deepEqual(saved.map(r=>r.status),['paid','refunded']);assert.equal(saved[1].revenueCents,null);
});
test('diagnóstico não registra mensagens livres ou códigos que possam repetir dados privados',async()=>{
 const x=setup();const logs:unknown[][]=[];const original=console.error;console.error=(...args)=>logs.push(args);
 x.setHandler(async()=>Response.json({error:'private-verifier',message:'private-verifier seller=123 from=2026-08-16'},{status:400}));
 try{await assert.rejects(x.service.remote('/oauth/token',undefined,new URLSearchParams({code_verifier:'private-verifier'})));}finally{console.error=original;}
 assert.equal(logs.length,1);assert.deepEqual(logs[0][1],{resource:'/oauth/token',status:400,code:'unrecognized_error'});
});
test('consulta bulk de anúncios não envia o formato novo exclusivo de envios',async()=>{
 const x=setup();const headers:Record<string,string|null>={bulk:null,shipment:null};
 x.setHandler(async(url,init)=>{
  const value=new Headers(init?.headers).get('x-format-new');
  if(url.pathname==='/items/bulk'){headers.bulk=value;return Response.json([])}
  if(url.pathname==='/shipments/1'){headers.shipment=value;return Response.json({})}
  throw Error(url.pathname);
 });
 await x.service.remote('/items/bulk?ids=MLB1','token');
 await x.service.remote('/shipments/1','token');
 assert.deepEqual(headers,{bulk:null,shipment:'true'});
});
test('depois do histórico busca somente alterações com sobreposição horária',async()=>{
 const x=setup();await x.authorize();let query=new URLSearchParams();
 x.setHandler(async url=>{if(url.pathname.endsWith('/discounts'))return Response.json({details:[]});query=url.searchParams;return Response.json({paging:{total:1,offset:0},results:[{...order(),shipping:null}]})});
 await x.service.sync('owner','a');x.advance(2*3600000);const result=await x.service.sync('owner','a');
 assert.equal(query.has('order.date_created.from'),false);
 assert.equal(query.get('order.date_last_updated.from'),'2026-09-15T15:00:00.000Z');
 assert.equal(query.get('order.date_last_updated.to'),'2026-09-15T18:00:00.000Z');
 assert.equal(result.mode,'incremental');assert.equal(x.sqlite.prepare('SELECT count(*) AS n FROM meli_orders').get()?.n,1);
});
test('nova versão do faturamento relê o histórico uma vez e depois volta ao incremental',async()=>{
 const x=setup();await x.authorize();x.sqlite.exec("UPDATE meli_connections SET sync_cursor='2026-09-15T14:00:00.000Z',gross_sales_version=1,logistics_version=2,financials_version=5");const fields:string[]=[];
 x.setHandler(async url=>{fields.push(url.searchParams.has('order.date_created.from')?'history':'incremental');return Response.json({paging:{total:0,offset:0},results:[]})});
 const rebuilt=await x.service.sync('owner','a');assert.equal(rebuilt.mode,'history');assert.equal(x.sqlite.prepare('SELECT gross_sales_version FROM meli_connections').get()?.gross_sales_version,2);
 x.advance(2*3600000);const resumed=await x.service.sync('owner','a');assert.equal(resumed.mode,'incremental');assert.deepEqual(fields,['history','incremental']);
});
test('nova versão logística relê o histórico uma vez e depois volta ao incremental',async()=>{
 const x=setup();await x.authorize();x.sqlite.exec("UPDATE meli_connections SET sync_cursor='2026-09-15T14:00:00.000Z',gross_sales_version=2,logistics_version=1,financials_version=5");const fields:string[]=[];
 x.setHandler(async url=>{fields.push(url.searchParams.has('order.date_created.from')?'history':'incremental');return Response.json({paging:{total:0,offset:0},results:[]})});
 const rebuilt=await x.service.sync('owner','a');assert.equal(rebuilt.mode,'history');assert.equal(x.sqlite.prepare('SELECT logistics_version FROM meli_connections').get()?.logistics_version,2);
 x.advance(2*3600000);const resumed=await x.service.sync('owner','a');assert.equal(resumed.mode,'incremental');assert.deepEqual(fields,['history','incremental']);
});
test('correção de descontos relê pedidos recentes uma vez no processamento automático',async()=>{
 const x=setup();await x.authorize();
 x.sqlite.exec("UPDATE meli_connections SET sync_cursor='2026-09-15T14:00:00.000Z',gross_sales_version=2,logistics_version=2,financials_version=2");
 const fields:string[]=[];
 x.setHandler(async url=>{fields.push(url.searchParams.has('order.date_created.from')?'history':'incremental');return Response.json({paging:{total:0,offset:0},results:[]})});
 const rebuilt=await x.service.sync('owner','a');
 assert.equal(rebuilt.mode,'history');
 assert.equal(x.sqlite.prepare('SELECT financials_version FROM meli_connections').get()?.financials_version,5);
 x.advance(2*3600000);
 const resumed=await x.service.sync('owner','a');
 assert.equal(resumed.mode,'incremental');
 assert.deepEqual(fields,['history','incremental']);
});
test('nova versão financeira relê o histórico uma vez e depois volta ao incremental',async()=>{
 const x=setup();await x.authorize();x.sqlite.exec("UPDATE meli_connections SET sync_cursor='2026-09-15T14:00:00.000Z',gross_sales_version=2,logistics_version=2,financials_version=1");const fields:string[]=[];
 x.setHandler(async url=>{fields.push(url.searchParams.has('order.date_created.from')?'history':'incremental');return Response.json({paging:{total:0,offset:0},results:[]})});
 const rebuilt=await x.service.sync('owner','a');assert.equal(rebuilt.mode,'history');assert.equal(x.sqlite.prepare('SELECT financials_version FROM meli_connections').get()?.financials_version,5);
 x.advance(2*3600000);const resumed=await x.service.sync('owner','a');assert.equal(resumed.mode,'incremental');assert.deepEqual(fields,['history','incremental']);
});
test('catálogo retoma da página salva, preserva antigos na falha e isola geração',async()=>{
 const x=setup();await x.authorize();let failSecond=true;
 x.sqlite.exec("INSERT INTO meli_listings VALUES('old','owner','a','MLB-OLD','','Antigo','active',NULL,'old-run',1)");
 const details=new Map([
  ['MLB1',{id:'MLB1',seller_id:456,title:'Primeiro',status:'active',last_updated:'2026-09-20T12:00:00Z',attributes:[],variations:[]}],
  ['MLB2',{id:'MLB2',seller_id:456,title:'Segundo',status:'paused',last_updated:'2026-09-20T12:00:00Z',attributes:[],variations:[{id:21,seller_custom_field:'SKU-21',attributes:[]}]}],
  ['MLB3',{id:'MLB3',seller_id:456,title:'Terceiro',status:'active',last_updated:'2026-09-20T12:00:00Z',attributes:[],variations:[]}],
 ]);
 x.setHandler(async url=>{
  if(url.pathname==='/users/456/items/search'){
   assert.equal(url.searchParams.get('limit'),'100');
   assert.equal(url.searchParams.get('search_type'),'scan');assert.equal(url.searchParams.has('offset'),false);
   const scroll=url.searchParams.get('scroll_id');
   if(!scroll)return Response.json({seller_id:456,paging:{total:3,limit:2},scroll_id:'cursor-1',results:['MLB1','MLB2']});
   assert.equal(scroll,'cursor-1');if(failSecond)return new Response(null,{status:503});
   return Response.json({seller_id:456,paging:{total:3,limit:2},scroll_id:'cursor-1',results:['MLB3']});
  }
  if(url.pathname==='/items/bulk'){
   return Response.json(String(url.searchParams.get('ids')).split(',').map(id=>({id,status_code:200,body:details.get(id)})));
  }
  throw Error(url.pathname);
 });
 const first=await x.service.syncCatalog('owner','a');assert.equal(first.status,'running');assert.equal(first.processed,2);
 assert.equal(x.sqlite.prepare("SELECT scroll_id FROM meli_catalog_runs WHERE account_id='a'").get()?.scroll_id,'cursor-1');
 assert.equal(x.sqlite.prepare('SELECT count(*) n FROM meli_listings WHERE account_id=\'a\'').get()?.n,3);
 await assert.rejects(x.service.syncCatalog('owner','a'));assert.equal(x.sqlite.prepare("SELECT offset FROM meli_catalog_runs WHERE account_id='a'").get()?.offset,2);
 assert.equal(x.sqlite.prepare("SELECT status FROM meli_listings WHERE id='old'").get()?.status,'active');
 await assert.rejects(x.service.syncCatalog('owner','a','wrong-generation'));
 failSecond=false;const completed=await x.service.syncCatalog('owner','a');assert.equal(completed.status,'complete');assert.equal(completed.processed,3);
 assert.equal(x.sqlite.prepare("SELECT status FROM meli_listings WHERE id='old'").get()?.status,'inactive');
 assert.equal(x.sqlite.prepare("SELECT count(*) n FROM meli_listings WHERE owner_id='other'").get()?.n,0);
});
test('catálogo divide uma página scan de cem IDs em detalhes de vinte',async()=>{
 const x=setup();await x.authorize();const ids=Array.from({length:45},(_,index)=>'MLB'+(index+1));const chunks:number[]=[];
 x.setHandler(async url=>{
  if(url.pathname==='/users/456/items/search')return Response.json({seller_id:456,paging:{total:45,limit:100},scroll_id:'cursor-1',results:ids});
  if(url.pathname==='/items/bulk'){
   const requested=String(url.searchParams.get('ids')).split(',');chunks.push(requested.length);
   return Response.json(requested.map(id=>({body:{id,seller_id:456,title:'Produto '+id,status:'active',last_updated:'2026-09-20T12:00:00Z',attributes:[],variations:[]}})));
  }
  throw Error(url.pathname);
 });
 const result=await x.service.syncCatalog('owner','a');
 assert.deepEqual(result,{status:'complete',processed:45,total:45});assert.deepEqual(chunks,[20,20,5]);
 assert.equal(x.sqlite.prepare("SELECT count(*) n FROM meli_listings WHERE account_id='a'").get()?.n,45);
});
test('sincronização concluída libera nova tentativa do catálogo em espera',async()=>{
 const x=setup();await x.authorize();
 const generation=String(x.sqlite.prepare("SELECT generation FROM meli_connections WHERE account_id='a'").get()?.generation);
 x.sqlite.prepare("INSERT INTO meli_jobs(id,owner_id,account_id,generation,resource,attempts,due_at,error,updated_at) VALUES(?,?,?,?,?,7,9999999999999,'Falha antiga',1)").run('a:'+generation+':catalog','owner','a',generation,'catalog');
 x.setHandler(async url=>{assert.equal(url.pathname,'/orders/search');return Response.json({paging:{total:0,offset:0},results:[]})});
 await x.service.sync('owner','a');
 const job=x.sqlite.prepare("SELECT attempts,due_at,error FROM meli_jobs WHERE resource='catalog'").get();
 assert.equal(job?.attempts,0);assert.equal(job?.error,null);assert.ok(Number(job?.due_at)<9999999999999);
});
test('sincronização não agenda nova leitura de catálogo recém-concluído',async()=>{
 const x=setup();await x.authorize();
 x.setHandler(async url=>{
  if(url.pathname==='/users/456/items/search')return Response.json({seller_id:456,paging:{total:0,limit:100},scroll_id:'cursor-1',results:[]});
  if(url.pathname==='/orders/search')return Response.json({paging:{total:0,offset:0},results:[]});
  throw Error(url.pathname);
 });
 await x.service.syncCatalog('owner','a');await x.service.sync('owner','a');
 assert.equal(x.sqlite.prepare("SELECT count(*) n FROM meli_jobs WHERE resource='catalog'").get()?.n,0);
});
test('catálogo reinicia progresso antigo sem cursor no modo scan',async()=>{
 const x=setup();await x.authorize();
 const generation=String(x.sqlite.prepare("SELECT generation FROM meli_connections WHERE account_id='a'").get()?.generation);
 x.sqlite.prepare("INSERT INTO meli_catalog_runs(account_id,owner_id,generation,id,offset,total,status,updated_at) VALUES('a','owner',?,'old-run',1080,1130,'paused',1)").run(generation);
 x.setHandler(async url=>{
  if(url.pathname==='/users/456/items/search'){
   assert.equal(url.searchParams.get('search_type'),'scan');assert.equal(url.searchParams.has('offset'),false);assert.equal(url.searchParams.has('scroll_id'),false);
   return Response.json({seller_id:456,paging:{total:1,limit:20},scroll_id:'cursor-1',results:['MLB1']});
  }
  if(url.pathname==='/items/bulk')return Response.json([{body:{id:'MLB1',seller_id:456,title:'Produto',status:'active',last_updated:'2026-09-20T12:00:00Z',attributes:[],variations:[]}}]);
  throw Error(url.pathname);
 });
 const result=await x.service.syncCatalog('owner','a');assert.deepEqual(result,{status:'complete',processed:1,total:1});
 const run=x.sqlite.prepare("SELECT status,offset,scroll_id FROM meli_catalog_runs WHERE account_id='a'").get();
 assert.deepEqual({...run},{status:'complete',offset:1,scroll_id:null});
});
test('catálogo reinicia scan quando o cursor expira',async()=>{
 const x=setup();await x.authorize();
 x.setHandler(async url=>{
  if(url.pathname==='/users/456/items/search')return Response.json({seller_id:456,paging:{total:2,limit:20},scroll_id:'cursor-1',results:['MLB1']});
  if(url.pathname==='/items/bulk')return Response.json([{body:{id:'MLB1',seller_id:456,title:'Produto',status:'active',last_updated:'2026-09-20T12:00:00Z',attributes:[],variations:[]}}]);
  throw Error(url.pathname);
 });
 await x.service.syncCatalog('owner','a');
 x.setHandler(async url=>{assert.equal(url.searchParams.get('scroll_id'),'cursor-1');return Response.json({error:'bad_request'},{status:400})});
 await assert.rejects(x.service.syncCatalog('owner','a'));
 const run=x.sqlite.prepare("SELECT status,offset,total,scroll_id FROM meli_catalog_runs WHERE account_id='a'").get();
 assert.deepEqual({...run},{status:'paused',offset:0,total:null,scroll_id:null});
});
test('falha incremental conserva cursor, período e offset até concluir',async()=>{
 const x=setup();await x.authorize();
 x.setHandler(async()=>Response.json({paging:{total:0,offset:0},results:[]}));await x.service.sync('owner','a');x.advance(2*3600000);
 let shouldFail=false;const seen:URLSearchParams[]=[];
 x.setHandler(async url=>{if(url.pathname.endsWith('/discounts'))return Response.json({details:[]});seen.push(url.searchParams);if(shouldFail)return new Response(null,{status:503});const offset=Number(url.searchParams.get('offset'));return Response.json({paging:{total:6,offset},results:(offset===0?[100,101,102,103,104]:[105]).map(id=>({...order(id),shipping:null}))})});
 const first=await x.service.sync('owner','a');assert.equal(first.mode,'incremental');assert.equal(first.processed,5);
 shouldFail=true;await assert.rejects(x.service.sync('owner','a'));assert.equal(x.sqlite.prepare('SELECT sync_cursor FROM meli_connections').get()?.sync_cursor,'2026-09-15T16:00:00.000Z');
 x.advance(2*3600000);shouldFail=false;const last=await x.service.sync('owner','a');
 assert.equal(last.status,'complete');assert.equal(last.needsMore,true);assert.equal(last.processed,6);assert.equal(seen.at(-1)?.get('offset'),'5');
 assert.equal(seen.at(-1)?.get('order.date_last_updated.from'),'2026-09-15T15:00:00.000Z');assert.equal(seen.at(-1)?.get('order.date_last_updated.to'),'2026-09-15T18:00:00.000Z');
 assert.equal(x.sqlite.prepare('SELECT sync_cursor FROM meli_connections').get()?.sync_cursor,'2026-09-15T18:00:00.000Z');
});
test('janela incremental atrasada inclui sobreposição dentro de 24 horas',async()=>{
 const x=setup();await x.authorize();x.sqlite.exec("UPDATE meli_connections SET sync_cursor='2026-09-12T16:00:00.000Z',gross_sales_version=2,logistics_version=2,financials_version=5");
 x.setHandler(async()=>Response.json({paging:{total:0,offset:0},results:[]}));
 const result=await x.service.sync('owner','a');
 assert.equal(Date.parse(result.toDate)-Date.parse(result.fromDate),86400000);
 assert.equal(result.needsMore,true);
});
test('status preserva recuperação pendente depois de concluir janela intermediária',async()=>{
 const x=setup();await x.authorize();x.sqlite.exec("UPDATE meli_connections SET sync_cursor='2026-09-12T16:00:00.000Z',gross_sales_version=2,logistics_version=2,financials_version=5");
 x.setHandler(async()=>Response.json({paging:{total:0,offset:0},results:[]}));
 await x.service.sync('owner','a');assert.equal((await x.service.status('owner')).connections[0].needsMore,true);
 for(let n=0;n<4;n++){const r=await x.service.sync('owner','a');if(!r.needsMore)break;}
 assert.equal((await x.service.status('owner')).connections[0].needsMore,false);
});
