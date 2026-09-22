import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applySaleCorrections,saleCorrectionSourceStamp} from '../lib/sale-corrections.ts';
import type {SaleCorrectionEvent} from '../lib/sale-corrections.ts';
import type {Sale} from '../lib/finance.ts';

const sale:Sale={
 id:'sale-1',orderId:'order-1',accountId:'account-a',sku:'64265',title:'Radiador',
 itemId:'MLB1',variationId:null,date:'2026-09-20',quantity:1,costQuantity:1,
 revenueCents:20000,feeCents:1300,shippingCents:null,otherCents:0,status:'paid',
 sourceStamp:'source-a',
};

function correction(overrides:Partial<SaleCorrectionEvent>={}):SaleCorrectionEvent{
 const event:SaleCorrectionEvent={
  id:'correction-1',accountId:'account-a',saleId:'sale-1',field:'shippingCents',
  revision:1,action:'set',mode:'fallback',value:1250,sourceValue:null,
  sourceStamp:'',requestId:'request-1',reason:'Campo ausente na API',
  createdAt:'2026-09-20T12:00:00.000Z',...overrides,
 };
 return {...event,sourceStamp:overrides.sourceStamp??saleCorrectionSourceStamp(sale,event.field)};
}

test('fallback preenche somente campo oficial ausente',()=>{
 const filled=applySaleCorrections(sale,[correction()]);
 const official=applySaleCorrections({...sale,shippingCents:900},[correction()]);
 assert.equal(filled.shippingCents,1250);
 assert.equal(filled.fieldSources?.shippingCents,'manual_fallback');
 assert.equal(filled.correctionState,'corrected');
 assert.equal(official.shippingCents,900);
 assert.notEqual(official.fieldSources?.shippingCents,'manual_fallback');
 assert.equal(official.correctionState,undefined);
});

test('override aplica enquanto o valor oficial do próprio campo permanece igual',()=>{
 const override=correction({field:'feeCents',mode:'override',value:1200,sourceValue:1300,sourceStamp:saleCorrectionSourceStamp(sale,'feeCents')});
 const applied=applySaleCorrections(sale,[override]);
 const unrelated=applySaleCorrections({...sale,shippingCents:600,sourceStamp:'outra-assinatura-global'},[override]);
 assert.equal(applied.feeCents,1200);
 assert.equal(applied.fieldSources?.feeCents,'manual_override');
 assert.equal(applied.correctionState,'corrected');
 assert.equal(unrelated.feeCents,1200);
 assert.equal(unrelated.correctionState,'corrected');
});

test('override fica stale quando o valor oficial do próprio campo muda',()=>{
 const override=correction({field:'feeCents',mode:'override',value:1200,sourceValue:1300,sourceStamp:saleCorrectionSourceStamp(sale,'feeCents')});
 const changedValue=applySaleCorrections({...sale,feeCents:1400},[override]);
 assert.equal(changedValue.feeCents,1400);
 assert.equal(changedValue.correctionState,'stale');
});

test('assinatura pode ser recalculada com o valor oficial ao editar uma correção aplicada',()=>{
 const override=correction({field:'feeCents',mode:'override',value:1200,sourceValue:1300,sourceStamp:saleCorrectionSourceStamp(sale,'feeCents')});
 const applied=applySaleCorrections(sale,[override]);
 assert.equal(applied.feeCents,1200);
 assert.equal(saleCorrectionSourceStamp(applied,'feeCents',override.sourceValue),override.sourceStamp);
});

test('correções são isoladas por venda, conta e campo',()=>{
 const events=[
  correction({id:'wrong-account',accountId:'account-b',revision:9,value:9999}),
  correction({id:'wrong-sale',saleId:'sale-2',revision:9,value:9999}),
  correction({id:'fee',field:'feeCents',mode:'override',value:1200,sourceValue:1300}),
 ];
 const result=applySaleCorrections(sale,events);
 assert.equal(result.shippingCents,null);
 assert.equal(result.feeCents,1200);
});

test('maior revisão prevalece mesmo fora de ordem',()=>{
 const result=applySaleCorrections(sale,[
  correction({id:'new',revision:3,value:1500}),
  correction({id:'old',revision:1,value:1000}),
  correction({id:'middle',revision:2,value:1400}),
 ]);
 assert.equal(result.shippingCents,1500);
});

test('clear remove somente a correção do campo correspondente',()=>{
 const result=applySaleCorrections(sale,[
  correction({id:'shipping-set',revision:1}),
  correction({id:'shipping-clear',revision:2,action:'clear',value:null}),
  correction({id:'fee-set',field:'feeCents',mode:'override',value:1200,sourceValue:1300}),
 ]);
 assert.equal(result.shippingCents,null);
 assert.equal(result.feeCents,1200);
 assert.equal(result.correctionState,'corrected');
});
