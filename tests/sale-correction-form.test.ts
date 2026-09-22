import test from 'node:test';
import assert from 'node:assert/strict';
import {correctionMode,formatCorrectionValue,parseCorrectionValue} from '../lib/sale-correction-form.ts';

test('valor financeiro aceita reais brasileiros e zero sem perder centavos',()=>{
 assert.deepEqual(parseCorrectionValue('feeCents','1.234,56'),{ok:true,value:123_456});
 assert.deepEqual(parseCorrectionValue('shippingCents','0'),{ok:true,value:0});
 assert.deepEqual(parseCorrectionValue('otherCents','12.34'),{ok:true,value:1_234});
});

test('quantidade aceita somente inteiro não negativo',()=>{
 assert.deepEqual(parseCorrectionValue('costQuantity','12'),{ok:true,value:12});
 for(const value of ['1,5','-1','abc',''])assert.equal(parseCorrectionValue('costQuantity',value).ok,false,value);
});

test('rejeita formato ambíguo, negativo e precisão acima de centavos',()=>{
 for(const value of ['1,234','-0,01','abc',''])assert.equal(parseCorrectionValue('revenueCents',value).ok,false,value);
});

test('modo depende da existência do valor oficial e formata cada campo',()=>{
 assert.equal(correctionMode(null),'fallback');
 assert.equal(correctionMode(0),'override');
 assert.equal(formatCorrectionValue('costQuantity',3),'3');
 assert.equal(formatCorrectionValue('revenueCents',123_456),'1.234,56');
});
