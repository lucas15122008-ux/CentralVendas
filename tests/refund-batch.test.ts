import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateSale,type Sale} from '../lib/finance.ts';
import {refundBatchCorrections,refundBatchSales} from '../lib/refund-batch.ts';
import {applySaleCorrections,refundIssue,type SaleCorrectionEvent} from '../lib/sale-corrections.ts';

const refunded:Sale={id:'a:1:0',orderId:'1',accountId:'a',sku:'X',title:'Produto',date:'2026-09-10',quantity:2,costQuantity:null,revenueCents:null,feeCents:1500,shippingCents:null,otherCents:0,status:'refunded',sourceIssues:[refundIssue],itemId:'MLB1',operation:{channel:'unknown',source:'unknown'},adProfile:{eventId:'p',revision:1,validFrom:'2026-01-01',unitCostTenThousandths:100_000,tax:{mode:'included'}},financialMode:'native'};
const paid:Sale={...refunded,id:'a:2:0',orderId:'2',status:'paid',sourceIssues:[],revenueCents:null};

function asEvents(sale:Sale,commands:ReturnType<typeof refundBatchCorrections>):SaleCorrectionEvent[]{
 return commands.filter(command=>command.saleId===sale.id).map((command,index)=>({...command,id:'e'+index,revision:command.expectedRevision+1,requestId:'r'+index,createdAt:'2026-09-28T12:00:00Z'}));
}

test('lote de devoluções só alcança vendas devolvidas com receita ou quantidade em aberto',()=>{
 assert.deepEqual(refundBatchSales([refunded,paid]).map(sale=>sale.id),['a:1:0']);
});

test('devolução com produto de volta ao estoque zera receita, custo e tarifa estornada',()=>{
 const commands=refundBatchCorrections([refunded,paid],[],{stockReturned:true,feeRefunded:true,reason:'Devolução total'});
 assert.deepEqual(commands.map(command=>[command.field,command.mode,command.value]),[['revenueCents','fallback',0],['costQuantity','fallback',0],['feeCents','override',0],['shippingCents','fallback',0]]);
 const corrected=applySaleCorrections(refunded,asEvents(refunded,commands));
 assert.equal(corrected.sourceIssues?.includes(refundIssue),false);
 const result=calculateSale(corrected,[]);
 assert.deepEqual(result.reasons,[]);
 assert.equal(result.contributionCents,0);
});

test('produto perdido mantém o custo e a tarifa cobrada continua oficial',()=>{
 const commands=refundBatchCorrections([refunded],[],{stockReturned:false,feeRefunded:false,reason:'Produto extraviado'});
 assert.equal(commands.some(command=>command.field==='feeCents'),false);
 assert.equal(commands.find(command=>command.field==='costQuantity')?.value,2);
 const result=calculateSale(applySaleCorrections(refunded,asEvents(refunded,commands)),[]);
 assert.equal(result.contributionCents,-1500-2000);
});

test('campo já corrigido à mão não é sobrescrito pelo lote',()=>{
 const manual:Sale={...refunded,revenueCents:500,fieldSources:{revenueCents:'manual_fallback'}};
 const commands=refundBatchCorrections([manual],[],{stockReturned:true,feeRefunded:true,reason:'Devolução total'});
 assert.equal(commands.some(command=>command.field==='revenueCents'),false);
});
