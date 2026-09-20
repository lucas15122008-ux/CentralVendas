import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestCoordinator} from '../lib/request-coordinator.ts';

test('refresh iniciado durante polling sempre executa uma leitura posterior',async()=>{
 const gates=[Promise.withResolvers<void>(),Promise.withResolvers<void>()];
 const secondStarted=Promise.withResolvers<void>();
 let calls=0;
 const coordinator=requestCoordinator(async()=>{const index=calls++;if(index===1)secondStarted.resolve();await gates[index].promise});
 const poll=coordinator.poll();
 const refresh=coordinator.refresh();
 assert.equal(calls,1);
 gates[0].resolve();
 await secondStarted.promise;
 assert.equal(calls,2);
 gates[1].resolve();
 await Promise.all([poll,refresh]);
});

test('refresh ainda inicia nova leitura quando o polling anterior falha',async()=>{
 let calls=0;
 const coordinator=requestCoordinator(async()=>{if(calls++===0)throw Error('falha anterior')});
 await assert.rejects(coordinator.poll());
 await coordinator.refresh();
 assert.equal(calls,2);
});
