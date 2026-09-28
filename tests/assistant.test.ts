import {test} from 'node:test';
import assert from 'node:assert/strict';
import {askAssistant,chatSchema} from '../lib/assistant.ts';
import {periodSummary,productRanking,searchSales,type AssistantData} from '../lib/assistant-tools.ts';
import type {Sale} from '../lib/finance.ts';

const now=new Date('2026-09-28T15:00:00Z');
const sale=(id:string,itemId:string,date:string,revenueCents:number,unitCost:number):Sale=>({id,orderId:id,accountId:'a',sku:'SKU-'+itemId,title:'Produto '+itemId,date,quantity:1,costQuantity:1,grossSalesCents:revenueCents,revenueCents,feeCents:1000,shippingCents:0,otherCents:0,status:'paid',itemId,operation:{channel:'other',source:'meli'},adProfile:{eventId:'e',revision:1,validFrom:'2026-01-01',unitCostTenThousandths:unitCost*100,tax:{mode:'included'}}});
const data:AssistantData={accounts:[{id:'a',name:'Loja'}],sales:[sale('1','MLB1','2026-09-27',10000,4000),sale('2','MLB2','2026-09-20',5000,6000),sale('3','MLB1','2026-08-01',10000,4000)],costs:[],listings:[],adSpend:[{accountId:'a',itemId:'MLB1',date:'2026-09-27',costCents:1500,clicks:10,prints:100,attributedCents:10000,attributedUnits:1}],pending:[],now};

test('ferramentas do agente resumem o período em reais e respeitam conta e dias',()=>{
 assert.deepEqual({...periodSummary(data,{dias:7}),periodo:undefined},{periodo:undefined,conta:'todas',faturamento:100,receita_liquida:100,contribuicao_antes_ads:50,margem_percent:50,investimento_ads:15,contribuicao_apos_ads:35,cobertura_percent:100,pedidos:1,pedidos_pagos:1,vendas_sem_resultado:0});
 assert.equal(periodSummary(data,{dias:30,conta:'loja'}).contribuicao_antes_ads,30);
 assert.throws(()=>periodSummary(data,{conta:'Outra'}),/não encontrada/);
 assert.deepEqual(productRanking(data,{ordenar:'prejuizo',limite:1}).produtos.map(row=>row.sku),['SKU-MLB2']);
 assert.equal(searchSales(data,{texto:'mlb1',dias:365}).encontradas,2);
});

test('conversa aceita só histórico curto que começa e termina com o usuário',()=>{
 assert.ok(chatSchema.safeParse({messages:[{role:'user',content:'Oi'}]}).success);
 assert.ok(!chatSchema.safeParse({messages:[{role:'assistant',content:'Oi'}]}).success);
 assert.ok(!chatSchema.safeParse({messages:[{role:'user',content:'Oi'},{role:'assistant',content:'Olá'}]}).success);
 assert.ok(!chatSchema.safeParse({messages:Array.from({length:21},()=>({role:'user',content:'x'}))}).success);
});

test('agente consulta a ferramenta e devolve a resposta final com fallback padrão',async()=>{
 const bodies:Record<string,unknown>[]=[];let beta='';
 const fetcher=(async(_url:string,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));bodies.push(body);beta=new Headers(init?.headers).get('anthropic-beta')??'';
  const usage={input_tokens:10,output_tokens:10};
  if(bodies.length===1)return Response.json({id:'m1',type:'message',role:'assistant',model:'claude-opus-5',content:[{type:'tool_use',id:'t1',name:'resumo_periodo',input:{dias:7}}],stop_reason:'tool_use',stop_sequence:null,usage});
  return Response.json({id:'m2',type:'message',role:'assistant',model:'claude-opus-5',content:[{type:'text',text:'Margem de 50% nos últimos 7 dias.'}],stop_reason:'end_turn',stop_sequence:null,usage});
 }) as unknown as typeof fetch;
 const reply=await askAssistant('test-key',data,[{role:'user',content:'Como foi a semana?'}],fetcher);
 assert.equal(reply,'Margem de 50% nos últimos 7 dias.');
 assert.equal(bodies[0].model,'claude-opus-5');
 assert.equal(bodies[0].fallbacks,'default');
 assert.match(beta,/server-side-fallback-2026-07-01/);
 const toolResult=JSON.stringify((bodies[1].messages as unknown[]).at(-1));
 assert.match(toolResult,/contribuicao_apos_ads/);
});
