import {test} from 'node:test';import assert from 'node:assert/strict';
import {seal,unseal,randomToken,pkceChallenge} from '../lib/meli/crypto.ts';
import {authorizationUrl,allocateCents,normalizeOrders,orderSchema} from '../lib/meli/protocol.ts';
import {parseSellerDiscounts} from '../lib/meli/discounts.ts';
import {parseCatalogPage} from '../lib/meli/catalog.ts';
const order={id:123,seller:{id:456},status:'paid',date_created:'2026-09-15T01:00:00Z',currency_id:'BRL',order_items:[{item:{id:'MLB123',title:'Produto',seller_sku:'00001'},quantity:2,unit_price:100,sale_fee:13}],shipping:{id:789},payments:[{status:'approved',transaction_amount:200,transaction_amount_refunded:0}]};
const normalizedOrder=orderSchema.parse(order);
const shipping={id:'789',sellerCostCents:1001,orderIds:['123'],complete:true,logisticType:null};
test('segredos cifrados não expõem texto e exigem contexto correto',async()=>{const key=randomToken(32);const c=await seal('secret-real',key,'owner/app');assert.ok(!c.includes('secret-real'));assert.equal(await unseal(c,key,'owner/app'),'secret-real');await assert.rejects(unseal(c,key,'other/app'));await assert.rejects(unseal(c.slice(0,-4)+'AAAA',key,'owner/app'));});
test('PKCE usa o vetor oficial S256',async()=>assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'));
test('autorização vincula state e callback sem enviar segredo',()=>{const url=new URL(authorizationUrl({clientId:'123',redirectUri:'https://example.test/api/meli/callback',pkce:true},'state-value','challenge'));assert.equal(url.origin,'https://auth.mercadolivre.com.br');assert.equal(url.searchParams.get('state'),'state-value');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.has('client_secret'),false);});
test('rateio preserva centavos e desempate determinístico',()=>{assert.deepEqual(allocateCents(100,[1,1,1]),[34,33,33]);assert.deepEqual(allocateCents(999,[100,200]),[333,666]);});
test('pedido preserva SKU, data brasileira e comissão por unidade',()=>{const [s]=normalizeOrders('a','456',[order],[shipping]);assert.equal(s.sku,'00001');assert.equal(s.date,'2026-09-14');assert.equal(s.revenueCents,20000);assert.equal(s.feeCents,2600);assert.equal(s.shippingCents,1001);});
test('tipo fulfillment do envio alcança todas as linhas do pedido',()=>{const rows=normalizeOrders('a','456',[order],[{...shipping,logisticType:'fulfillment'}]);assert.deepEqual(rows.map(row=>row.logisticType),['fulfillment']);});
test('tipo logístico ausente permanece desconhecido',()=>{const [row]=normalizeOrders('a','456',[order],[shipping]);assert.equal(row.logisticType,null);});
test('frete de carrinho é rateado uma única vez entre pedidos',()=>{const other={...order,id:124,order_items:[{...order.order_items[0],quantity:1}]};const rows=normalizeOrders('a','456',[order,other],[{...shipping,orderIds:['123','124']}]);assert.equal(rows.reduce((sum,s)=>sum+(s.shippingCents??0),0),1001);assert.deepEqual(rows.map(s=>s.shippingCents),[667,334]);});
test('envio incompleto e tarifa ausente permanecem nulos',()=>{const [s]=normalizeOrders('a','456',[{...order,order_items:[{...order.order_items[0],sale_fee:undefined}]}],[{...shipping,orderIds:['123','999']}]);assert.equal(s.shippingCents,null);assert.equal(s.feeCents,null);});
test('pedido de outro vendedor é recusado',()=>assert.throws(()=>normalizeOrders('a','999',[order],[shipping])));
test('reembolso não presume recuperação do estoque nem receita líquida',()=>{const [s]=normalizeOrders('a','456',[{...order,payments:[{status:'refunded',transaction_amount_refunded:200}]}],[shipping]);assert.equal(s.status,'refunded');assert.equal(s.revenueCents,null);assert.equal(s.costQuantity,null);});
test('pedido sem SKU não é associado por título',()=>{const [s]=normalizeOrders('a','456',[{...order,order_items:[{...order.order_items[0],item:{id:'MLB123',title:'Produto'}}]}],[shipping]);assert.ok(s.sourceIssues?.some(x=>x.includes('SKU')));assert.notEqual(s.sku,'00001');});
test('cancelamento com frete permanece visível como conciliação pendente',()=>{const [s]=normalizeOrders('a','456',[{...order,status:'cancelled'}],[shipping]);assert.equal(s.status,'refunded');assert.equal(s.revenueCents,null);assert.equal(s.costQuantity,null);assert.equal(s.shippingCents,1001);});
test('status de reembolso parcial não depende da presença dos pagamentos',()=>{const [s]=normalizeOrders('a','456',[{...order,status:'partially_refunded',payments:undefined}],[shipping]);assert.equal(s.status,'refunded');assert.equal(s.revenueCents,null);});
test('cupom mantém a receita e deixa só a parte do vendedor pendente',()=>{const [s]=normalizeOrders('a','456',[{...order,payments:[{status:'approved',coupon_amount:10}]}],[shipping]);assert.equal(s.grossSalesCents,20000);assert.equal(s.revenueCents,20000);assert.equal(s.otherCents,null);});
test('promoção de preço já está no preço e não deixa a venda pendente',()=>{const [s]=normalizeOrders('a','456',[{...order,tags:['paid'],order_items:[{...order.order_items[0],discounts:[{amounts:{full:10,seller:5}}],gross_price:220}]}],[shipping]);assert.equal(s.grossSalesCents,20000);assert.equal(s.revenueCents,20000);assert.equal(s.otherCents,0);assert.deepEqual(s.sourceIssues,[]);});
test('cancelamento não entra no faturamento informado',()=>{const [s]=normalizeOrders('a','456',[{...order,status:'cancelled'}],[shipping]);assert.equal(s.grossSalesCents,null);});
test('preço ausente preserva a venda com receita e rateio pendentes',()=>{const [s]=normalizeOrders('a','456',[{...order,order_items:[{...order.order_items[0],unit_price:undefined}]}],[shipping]);assert.equal(s.revenueCents,null);assert.equal(s.shippingCents,null);});
test('desconto separa somente a parcela paga pelo vendedor',()=>{
 const parsed=parseSellerDiscounts(normalizedOrder,{details:[{type:'coupon',items:[{id:'MLB123',quantity:2,amounts:{total:20,seller:5}}]}]});
 assert.ok(parsed);assert.deepEqual(parsed.sellerCentsByLine,[500]);assert.equal(parsed.hasDiscounts,true);
 const [sale]=normalizeOrders('a','456',[order],[shipping],new Map([['123',parsed]]));
 assert.equal(sale.revenueCents,20000);assert.equal(sale.otherCents,500);
});
test('subsídio do Mercado Livre não vira despesa e resposta vazia confirma zero',()=>{
 const subsidized=parseSellerDiscounts(normalizedOrder,{details:[{type:'cashback',items:[{id:'MLB123',quantity:2,amounts:{total:20,seller:0}}]}]});
 const empty=parseSellerDiscounts(normalizedOrder,{details:[]});
 assert.ok(subsidized);assert.ok(empty);
 assert.equal(normalizeOrders('a','456',[order],[shipping],new Map([['123',subsidized]]))[0].otherCents,0);
 assert.equal(normalizeOrders('a','456',[order],[shipping],new Map([['123',empty]]))[0].revenueCents,20000);
});
test('promoção de campanha já reduz o preço e não vira despesa de novo',()=>{
 const parsed=parseSellerDiscounts(normalizedOrder,{details:[
  {type:'campaign',items:[{id:'MLB123',quantity:2,amounts:{total:40,seller:30}}]},
  {type:'coupon',items:[{id:'MLB123',quantity:2,amounts:{total:20,seller:5}}]},
 ]});
 assert.ok(parsed);assert.deepEqual(parsed.sellerCentsByLine,[500]);assert.equal(parsed.hasDiscounts,true);
 const [sale]=normalizeOrders('a','456',[order],[shipping],new Map([['123',parsed]]));
 assert.equal(sale.revenueCents,20000);assert.equal(sale.otherCents,500);
});
test('desconto malformado ou alvo ambíguo permanece desconhecido',()=>{
 assert.equal(parseSellerDiscounts(normalizedOrder,{details:[{type:'coupon',items:[{id:'MLB123',quantity:2,amounts:{total:5,seller:6}}]}]}),null);
 const ambiguous={...order,order_items:[
  {...order.order_items[0],quantity:1,item:{...order.order_items[0].item,variation_id:1}},
  {...order.order_items[0],quantity:1,item:{...order.order_items[0].item,variation_id:2}},
 ]};
 const parsed=parseSellerDiscounts(orderSchema.parse(ambiguous),{details:[{type:'coupon',items:[{id:'MLB123',quantity:1,amounts:{total:5,seller:2}}]}]});
 assert.equal(parsed,null);
 const [sale]=normalizeOrders('a','456',[{...order,payments:[{status:'approved',coupon_amount:10}]}],[shipping],new Map([['123',null]]));
 assert.equal(sale.revenueCents,20000);assert.equal(sale.otherCents,null);
 const [plain]=normalizeOrders('a','456',[order],[shipping],new Map([['123',null]]));
 assert.equal(plain.otherCents,0);
});
test('catálogo cria alvo sem variação e um alvo por variação',()=>{
 const search={seller_id:456,paging:{total:2,offset:0,limit:2},results:['MLB1','MLB2']};
 const items=[
  {id:'MLB1',status_code:200,body:{id:'MLB1',seller_id:456,title:'Sem variação',status:'active',last_updated:'2026-09-20T12:00:00Z',attributes:[{id:'SELLER_SKU',value_name:'SKU-1'}],variations:[]}},
  {id:'MLB2',status_code:200,body:{id:'MLB2',seller_id:456,title:'Com variações',status:'paused',last_updated:'2026-09-21T12:00:00Z',attributes:[],variations:[
   {id:21,seller_custom_field:'SKU-21',attributes:[]},
   {id:22,seller_custom_field:null,attributes:[]},
  ]}},
 ];
 const listings=parseCatalogPage(search,items,'account-a');
 assert.equal(listings.length,3);
 assert.deepEqual(listings.map(row=>[row.itemId,row.variationId,row.sellerSku,row.status]),[
  ['MLB1',null,'SKU-1','active'],['MLB2','21','SKU-21','paused'],['MLB2','22',null,'paused'],
 ]);
 assert.notEqual(listings[0].id,parseCatalogPage(search,items,'account-b')[0].id);
});
test('catálogo recusa resposta malformada e item de outro vendedor',()=>{
 const search={seller_id:456,paging:{total:1,offset:0,limit:50},results:['MLB1']};
 const body={id:'MLB1',seller_id:456,title:'Produto',status:'active',last_updated:'2026-09-20T12:00:00Z',attributes:[],variations:[]};
 assert.throws(()=>parseCatalogPage(search,[{id:'MLB1',status_code:200,body:{...body,title:undefined}}],'a'));
 assert.throws(()=>parseCatalogPage(search,[{id:'MLB1',status_code:200,body:{...body,seller_id:999}}],'a'));
});
test('catálogo ignora detalhe indisponível sem aceitar falha ou item ausente',()=>{
 const search={seller_id:456,paging:{total:2,offset:0,limit:20},results:['MLB1','MLB2']};
 const body={id:'MLB1',seller_id:456,title:'Produto',status:'active',last_updated:'2026-09-20T12:00:00Z',attributes:[],variations:[]};
 assert.deepEqual(parseCatalogPage(search,[{id:'MLB1',status_code:200,body},{id:'MLB2',status_code:404}],'a').map(row=>row.itemId),['MLB1']);
 assert.throws(()=>parseCatalogPage(search,[{id:'MLB1',status_code:200,body},{id:'MLB2',status_code:500}],'a'));
 assert.throws(()=>parseCatalogPage(search,[{id:'MLB1',status_code:200,body}],'a'));
});
test('catálogo aceita o envelope body-only devolvido pela consulta bulk com atributos',()=>{
 const search={seller_id:456,paging:{total:1,offset:0,limit:20},results:['MLB1']};
 const body={id:'MLB1',seller_id:456,title:'Produto',status:'active',last_updated:'2026-09-20T12:00:00Z',attributes:[{id:'SELLER_SKU',value_name:'SKU-1'}],variations:[]};
 assert.deepEqual(parseCatalogPage(search,[{body}],'a').map(row=>[row.itemId,row.sellerSku]),[['MLB1','SKU-1']]);
});
