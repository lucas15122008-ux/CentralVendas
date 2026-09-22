import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activeAdProfile,adTargetKey,latestAdProfile} from '../lib/ad-profiles.ts';
import {applyAdProfiles} from '../lib/sale-projection.ts';
import {calculateSale} from '../lib/finance.ts';
import type {Sale} from '../lib/finance.ts';
import type {AdProfileEvent,AdProfilePayload} from '../lib/ad-profiles.ts';

const sale:Sale={
 id:'sale-1',orderId:'order-1',accountId:'account-a',sku:'64265',title:'Radiador',
 itemId:'MLB1',variationId:'variation-a',date:'2026-09-20',quantity:2,costQuantity:2,
 revenueCents:30000,feeCents:3000,shippingCents:1000,otherCents:0,status:'paid',logisticType:'cross_docking',
};

const included:AdProfilePayload={
 unitCostTenThousandths:1_000_050,
 tax:{mode:'included'},
 operation:'auto',
};

function event(overrides:Partial<AdProfileEvent>={}):AdProfileEvent{
 return {
  id:'profile-1',accountId:'account-a',itemId:'MLB1',variationId:'variation-a',
  validFrom:'2026-09-01',revision:1,action:'set',payload:included,
  requestId:'request-1',reason:'Cadastro inicial',origin:'native',
  createdAt:'2026-09-01T12:00:00.000Z',...overrides,
 };
}

test('chave do anúncio preserva variação nula e rejeita string vazia',()=>{
 assert.equal(adTargetKey('MLB1',null),'["MLB1",null]');
 assert.equal(adTargetKey('MLB1',undefined),'["MLB1",null]');
 assert.throws(()=>adTargetKey('MLB1',''));
});

test('perfil ativo usa a maior revisão vigente do alvo exato',()=>{
 const events=[
  event(),
  event({id:'profile-2',revision:2,payload:{...included,unitCostTenThousandths:900_000}}),
  event({id:'future',validFrom:'2026-09-21',revision:1}),
  event({id:'other-account',accountId:'account-b',revision:9}),
  event({id:'other-item',itemId:'MLB2',revision:9}),
  event({id:'other-variation',variationId:'variation-b',revision:9}),
 ];
 assert.equal(activeAdProfile(events,sale)?.revision,2);
 assert.equal(activeAdProfile(events,sale)?.id,'profile-2');
});

test('clear retira somente a vigência correspondente e revela a anterior',()=>{
 const events=[
  event({id:'old',validFrom:'2026-08-01'}),
  event({id:'new',validFrom:'2026-09-01'}),
  event({id:'clear-new',validFrom:'2026-09-01',revision:2,action:'clear',payload:null}),
 ];
 assert.equal(activeAdProfile(events,sale)?.id,'old');
 assert.equal(latestAdProfile(events,'account-a','MLB1','variation-a')?.id,'old');
});

test('venda sem item ou com variação distinta não recebe ficha',()=>{
 assert.equal(activeAdProfile([event()],{...sale,itemId:undefined}),undefined);
 assert.equal(activeAdProfile([event()],{...sale,variationId:'variation-b'}),undefined);
});

test('ficha arredonda custo unitário somente depois de multiplicar a quantidade',()=>{
 const profiled=applyAdProfiles([sale],[event()])[0];
 const result=calculateSale(profiled,[]);
 assert.equal(result.costCents,20001);
 assert.equal(result.taxCents,0);
 assert.equal(result.contributionCents,5999);
 assert.equal(result.fieldSources?.costCents,'ad_profile');
 assert.equal(result.fieldSources?.taxCents,'ad_profile');
});

test('imposto adicional da ficha aceita valor unitário, percentual e zero declarado',()=>{
 const unit=event({payload:{...included,tax:{mode:'unit',valueTenThousandths:23_450}}});
 const percent=event({payload:{...included,tax:{mode:'percent',rateBasisPoints:600}}});
 const zero=event({payload:{...included,tax:{mode:'unit',valueTenThousandths:0}}});
 assert.equal(calculateSale(applyAdProfiles([sale],[unit])[0],[]).taxCents,469);
 assert.equal(calculateSale(applyAdProfiles([sale],[percent])[0],[]).taxCents,1800);
 assert.equal(calculateSale(applyAdProfiles([sale],[zero])[0],[]).taxCents,0);
});

test('ficha futura não converte campo ausente em zero',()=>{
 const result=calculateSale(applyAdProfiles([sale],[event({validFrom:'2026-09-21'})])[0],[]);
 assert.equal(result.costCents,null);
 assert.equal(result.taxCents,null);
 assert.equal(result.contributionCents,null);
});

test('logística oficial prevalece e operação da ficha só resolve canal desconhecido',()=>{
 const full=applyAdProfiles([{...sale,logisticType:'fulfillment'}],[event({payload:{...included,operation:'other'}})])[0];
 const configured=applyAdProfiles([{...sale,logisticType:null}],[event({payload:{...included,operation:'full'}})])[0];
 const automatic=applyAdProfiles([{...sale,logisticType:null}],[event({payload:{...included,operation:'auto'}})])[0];
 assert.equal(full.operation?.channel,'full');
 assert.equal(full.operation?.source,'meli');
 assert.ok(full.operation?.conflict);
 assert.equal(configured.operation?.channel,'full');
 assert.equal(configured.operation?.source,'product');
 assert.equal(automatic.operation?.channel,'unknown');
});
