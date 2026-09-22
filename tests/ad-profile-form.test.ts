import test from 'node:test';
import assert from 'node:assert/strict';
import {formatBasisPoints,formatTenThousandths,isPastValidity,parseAdProfileForm,type AdProfileFormValues} from '../lib/ad-profile-form.ts';

const form=(overrides:Partial<AdProfileFormValues>={}):AdProfileFormValues=>({unitCost:'1.234,5678',taxMode:'unit',taxValue:'12,3456',operation:'auto',validFrom:'2026-09-01',reason:'Custo confirmado no ERP',...overrides});

test('aceita vírgula, milhar, zero e quatro casas sem arredondar custo unitário',()=>{
 const parsed=parseAdProfileForm(form());assert.equal(parsed.ok,true);if(!parsed.ok)return;
 assert.deepEqual(parsed.value.payload,{unitCostTenThousandths:12_345_678,tax:{mode:'unit',valueTenThousandths:123_456},operation:'auto'});
 const zero=parseAdProfileForm(form({unitCost:'0',taxValue:'0'}));assert.equal(zero.ok,true);if(zero.ok)assert.deepEqual(zero.value.payload.tax,{mode:'unit',valueTenThousandths:0});
});

test('imposto incluído ignora o campo de valor e percentual fica entre zero e cem',()=>{
 const included=parseAdProfileForm(form({taxMode:'included',taxValue:'texto antigo'}));assert.equal(included.ok,true);if(included.ok)assert.deepEqual(included.value.payload.tax,{mode:'included'});
 const percent=parseAdProfileForm(form({taxMode:'percent',taxValue:'6,1234'}));assert.equal(percent.ok,true);if(percent.ok)assert.deepEqual(percent.value.payload.tax,{mode:'percent',rateBasisPoints:612});
 for(const taxValue of ['','-1','100,0001','abc'])assert.equal(parseAdProfileForm(form({taxMode:'percent',taxValue})).ok,false,taxValue);
});

test('rejeita precisão excessiva, negativos, data inválida e motivo vazio',()=>{
 for(const value of ['1,23456','-0,01','abc',''])assert.equal(parseAdProfileForm(form({unitCost:value})).ok,false,value);
 assert.equal(parseAdProfileForm(form({taxValue:'1,23456'})).ok,false);
 assert.equal(parseAdProfileForm(form({validFrom:'2026-02-30'})).ok,false);
 assert.equal(parseAdProfileForm(form({reason:'  '})).ok,false);
});

test('formata valores persistidos e identifica vigência passada',()=>{
 assert.equal(formatTenThousandths(12_345_678),'1234,5678');
 assert.equal(formatTenThousandths(0),'0');
 assert.equal(formatBasisPoints(612),'6,12');
 assert.equal(isPastValidity('2026-09-01','2026-09-22'),true);
 assert.equal(isPastValidity('2026-09-22','2026-09-22'),false);
});
