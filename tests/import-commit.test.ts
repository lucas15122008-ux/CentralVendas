import {test} from 'node:test';
import assert from 'node:assert/strict';
import {commitImportBatch} from '../lib/import-commit.ts';

const failure=new Error('resposta da transação perdida');
test('resposta perdida após commit preserva o arquivo original',async()=>{
 const removed:string[]=[];
 const saved=await commitImportBatch({id:'new',commit:async()=>{throw failure},findSaved:async()=>({id:'new',withdrawnAt:null}),discard:async()=>{removed.push('file')}});
 assert.equal(saved?.id,'new');assert.deepEqual(removed,[]);
});
test('resultado incerto do banco não apaga o documento',async()=>{
 let removed=false;
 await assert.rejects(commitImportBatch({id:'new',commit:async()=>{throw failure},findSaved:async()=>{throw new Error('banco indisponível')},discard:async()=>{removed=true}}),failure);
 assert.equal(removed,false);
});
test('rollback confirmado permite remover somente o arquivo órfão',async()=>{
 let removed=false;
 await assert.rejects(commitImportBatch({id:'new',commit:async()=>{throw failure},findSaved:async()=>null,discard:async()=>{removed=true}}),failure);
 assert.equal(removed,true);
});
test('reenvios concorrentes retornam o lote vencedor e removem o arquivo extra',async()=>{
 let removed=false;
 const saved=await commitImportBatch({id:'new',commit:async()=>{throw failure},findSaved:async()=>({id:'existing',withdrawnAt:null}),discard:async()=>{removed=true}});
 assert.equal(saved?.id,'existing');assert.equal(removed,true);
});
test('commit bem sucedido não exige consulta ou limpeza',async()=>{
 const saved=await commitImportBatch({id:'new',commit:async()=>{},findSaved:async()=>{throw Error('consulta desnecessária')},discard:async()=>{throw Error('limpeza indevida')}});
 assert.equal(saved,null);
});
