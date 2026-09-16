import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visiblePoll} from '../lib/visible-poll.ts';
test('consultas aguardam a anterior e param ao ocultar ou desmontar',async()=>{
 let visibility='visible',listener=()=>{},scheduled:(()=>void)|undefined,calls=0,resolve=()=>{};
 const stop=visiblePoll(async()=>{calls++;await new Promise<void>(r=>{resolve=r})},{visibility:()=>visibility,listen:fn=>{listener=fn;return()=>{listener=()=>{}}},schedule:fn=>{scheduled=fn;return()=>{scheduled=undefined}}});
 const first=scheduled!;scheduled=undefined;first();assert.equal(calls,1);listener();assert.equal(calls,1);
 visibility='hidden';listener();resolve();await new Promise(r=>setImmediate(r));assert.equal(scheduled,undefined);
 visibility='visible';listener();assert.equal(calls,2);stop();resolve();await new Promise(r=>setImmediate(r));assert.equal(scheduled,undefined);listener();assert.equal(calls,2);
});
