import {test} from 'node:test';
import assert from 'node:assert/strict';
import {businessDate,periodStart} from '../lib/dates.ts';
test('virada do dia usa São Paulo mesmo com servidor em UTC',()=>assert.equal(businessDate(new Date('2026-09-15T01:00:00Z')),'2026-09-14'));
test('período inclusivo atravessa mês sem depender do fuso do navegador',()=>assert.equal(periodStart(7,new Date('2026-03-03T01:00:00Z')),'2026-02-24'));
