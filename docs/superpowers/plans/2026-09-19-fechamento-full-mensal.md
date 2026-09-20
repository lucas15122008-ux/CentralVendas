# Fechamento Mensal Full Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classificar vendas Full por envio/anúncio, estimar a despesa durante o mês e fechar o total mensal por rateio exato entre as unidades elegíveis.

**Architecture:** O pedido normalizado passa a preservar o tipo logístico oficial; a projeção de conciliação combina esse sinal com ajustes individuais e regras vigentes do anúncio. Fechamentos mensais são revisões imutáveis em D1 com parcelas por venda, aplicadas por uma projeção financeira única consumida por todas as telas. Meses abertos usam a taxa unitária do último fechamento válido da mesma conta e ficam explicitamente provisórios.

**Tech Stack:** TypeScript 5.9, React 19, Next/Vinext, Cloudflare Workers, D1/SQLite, Drizzle ORM, Zod, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-19-fechamento-full-mensal-design.md`

## Global Constraints

- Valores monetários são inteiros em centavos de BRL; custos unitários existentes continuam com quatro casas e arredondamento após multiplicar a quantidade.
- Mês e data comercial usam `America/Sao_Paulo`; a competência tem formato estrito `YYYY-MM`.
- O total do demonstrativo Full existe apenas por conta e mês; o rateio final é por unidade elegível e deve preservar exatamente todos os centavos.
- O tipo logístico oficial do envio prevalece sobre correção manual da venda e configuração vigente do anúncio.
- SKU, título e preço nunca inferem Full; conta, anúncio, variação e vigência isolam a configuração.
- Dados originais do Mercado Livre, planilhas e revisões anteriores são imutáveis; toda escrita é privada, idempotente e auditável.
- Valor ausente continua desconhecido; o primeiro mês sem taxa anterior não usa zero como estimativa.
- Ajuste individual e fechamento mensal nunca deduzem a mesma despesa Full duas vezes.
- Não reduzir os escopos OAuth atuais nem alterar anúncios, estoque ou modalidade logística no Mercado Livre.
- Não adicionar dependência de produção para o motor de cálculo ou para a persistência.

## Review Focus

- **Mesmo SKU em duas ofertas logísticas:** o SKU 64265 pode ter venda Full e comum; somente a linha Full recebe rateio. Coberto nas Tasks 3 e 4.
- **Recarga perdida após salvar:** uma consulta iniciada antes da mutação não pode substituir nem dispensar a recarga posterior. Coberto na Task 1.
- **Centavos indivisíveis e quantidades múltiplas:** a soma das parcelas precisa ser igual ao total com desempate estável. Coberto na Task 4.
- **Mudança depois do fechamento:** cancelamento, devolução, quantidade, modalidade ou custo alterado marca a revisão e deixa a contribuição atual pendente. Coberto nas Tasks 4 e 6.
- **Despesa manual simultânea:** venda com Full individual maior que zero bloqueia o fechamento e jamais sofre dupla dedução. Coberto nas Tasks 4 e 5.

---

## File Structure

**Create**

- `lib/request-coordinator.ts` — coordena consulta periódica e recarga obrigatória após mutação.
- `lib/allocation.ts` — rateio determinístico de centavos, independente da integração Mercado Livre.
- `lib/full-reconciliation.ts` — elegibilidade, retrato mensal, parcelas, estimativas e aplicação de fechamentos.
- `lib/full-closure-store.ts` — leitura e gravação privada/atômica das revisões e parcelas.
- `app/api/full-closures/route.ts` — prévia, fechamento e retirada do mês.
- `components/full-closure-panel.tsx` — interface mensal na Conciliação.
- `components/product-logistics-dialog.tsx` — configuração de anúncios/variações na aba Produtos.
- `tests/request-coordinator.test.ts` — concorrência entre polling e recarga após mutação.
- `tests/full-reconciliation.test.ts` — regras puras de classificação, fechamento e estimativa.

**Modify**

- `lib/meli/protocol.ts` — normaliza `logisticType` por linha e usa o rateador compartilhado.
- `lib/meli/service.ts` — consulta o detalhe do envio e agenda uma releitura única dos pedidos recentes.
- `lib/finance.ts` — representa origem/estado Full e deduz uma única despesa efetiva.
- `lib/reconciliation.ts` — estende vínculo de produto e resolve a modalidade efetiva.
- `lib/demo.ts` — expõe resumos de fechamento no contrato `Workspace`.
- `db/schema.ts` — adiciona versão logística, cabeçalhos de fechamento e parcelas.
- `drizzle/meta/_journal.json` e novo snapshot — metadados gerados pelo Drizzle.
- `app/api/reconciliation/route.ts` — aceita modalidade esperada opcional no vínculo.
- `app/api/workspace/route.ts` — aplica conciliação individual e mensal antes de responder.
- `components/commerce-app.tsx` — usa recarga obrigatória após mutações e distribui os novos dados.
- `components/reconciliation-view.tsx` — inclui o painel mensal e a modalidade esperada no vínculo.
- `components/finance-views.tsx` — exibe estados provisório/fechado e abre a configuração de ofertas.
- `app/globals.css` — estilos responsivos dos novos estados, painel e diálogos.
- `tests/meli.test.ts`, `tests/meli-service.test.ts`, `tests/reconciliation-engine.test.ts`, `tests/reconciliation.test.ts`, `tests/migrations.test.ts`, `tests/api.local.mjs` — cobertura integrada.
- `README.md` — descreve configuração Full e fechamento mensal.

---

### Task 1: Garantir recarga nova depois de cada mutação

**Files:**
- Create: `lib/request-coordinator.ts`
- Create: `tests/request-coordinator.test.ts`
- Modify: `components/commerce-app.tsx:13-29`
- Modify: `components/reconciliation-view.tsx:19-74`

**Interfaces:**
- Produces: `requestCoordinator(run: () => Promise<void>): { poll(): Promise<void>; refresh(): Promise<void> }`.
- `poll()` compartilha a consulta em voo; `refresh()` espera a consulta em voo e sempre inicia outra consulta depois.

- [ ] **Step 1: Write the failing concurrency test**

```ts
test('refresh iniciado durante polling sempre executa uma leitura posterior',async()=>{
 const gates=[Promise.withResolvers<void>(),Promise.withResolvers<void>()];
 let calls=0;const coordinator=requestCoordinator(async()=>{await gates[calls++].promise});
 const poll=coordinator.poll();
 const refresh=coordinator.refresh();
 assert.equal(calls,1);
 gates[0].resolve();await Promise.resolve();
 assert.equal(calls,2);
 gates[1].resolve();await Promise.all([poll,refresh]);
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `node --test tests/request-coordinator.test.ts`

Expected: FAIL because `requestCoordinator` does not exist.

- [ ] **Step 3: Implement the coordinator**

```ts
export function requestCoordinator(run:()=>Promise<void>){
 let active:Promise<void>|null=null;
 const poll=()=>active??(active=run().finally(()=>{active=null}));
 const refresh=async()=>{if(active)try{await active}catch{};await poll()};
 return {poll,refresh};
}
```

- [ ] **Step 4: Wire polling and mutation reloads separately**

In `commerce-app.tsx`, replace the boolean `loadingRequest` with one coordinator held in a ref. Use `coordinator.poll` for initial load and `visiblePoll`; pass `coordinator.refresh` as `onReload` to `ReconciliationView`, `CostImporter`, `CostsView`, `MeliAccounts` and account creation callbacks. Preserve the existing loading and error state inside the coordinator's `run` function.

- [ ] **Step 5: Run focused and existing tests**

Run: `node --test tests/request-coordinator.test.ts tests/visible-poll.test.ts tests/reconciliation.test.ts`

Expected: PASS. Saving during an in-flight poll causes two reads and the second read happens after the mutation.

- [ ] **Step 6: Commit the reload fix**

```bash
git add lib/request-coordinator.ts tests/request-coordinator.test.ts components/commerce-app.tsx components/reconciliation-view.tsx
git commit -m "fix: refresh financial data after reconciliation"
```

---

### Task 2: Preserve the official Mercado Livre logistics type

**Files:**
- Create: `lib/allocation.ts`
- Modify: `lib/meli/protocol.ts:1-44`
- Modify: `lib/meli/service.ts:10-12,50-65,118-141,143-213`
- Modify: `lib/finance.ts:1-3`
- Modify: `tests/meli.test.ts:1-21`
- Modify: `tests/meli-service.test.ts:14-22,58-63`
- Modify: `tests/helpers/meli.ts:17`

**Interfaces:**
- Produces: `allocateCents(total: number, weights: number[]): number[]` in `lib/allocation.ts`.
- Extends: `ShipmentCost` with `logisticType: string | null`.
- Extends: `Sale` with `logisticType?: string | null`.
- Consumes: shipment response `{ logistic?: { type?: string }, logistic_type?: string }`.

- [ ] **Step 1: Add failing normalization tests**

```ts
test('tipo fulfillment do envio alcança todas as linhas do pedido',()=>{
 const rows=normalizeOrders('a','456',[order],[{...shipping,logisticType:'fulfillment'}]);
 assert.deepEqual(rows.map(row=>row.logisticType),['fulfillment']);
});

test('tipo logístico ausente permanece desconhecido',()=>{
 const [row]=normalizeOrders('a','456',[order],[{...shipping,logisticType:null}]);
 assert.equal(row.logisticType,null);
});
```

- [ ] **Step 2: Run the protocol tests and observe failure**

Run: `node --test tests/meli.test.ts`

Expected: FAIL because `ShipmentCost` and `Sale` do not carry `logisticType`.

- [ ] **Step 3: Extract the generic allocator without behavior change**

Move the existing `allocateCents` implementation byte-for-byte from `lib/meli/protocol.ts` to `lib/allocation.ts`, import it back into the protocol, and keep the existing cent-allocation test passing.

- [ ] **Step 4: Normalize the shipment type into each sale line**

```ts
const shipmentById=new Map(shipments.map(shipment=>[shipment.id,shipment]));
const logisticType=order.shipping?.id?shipmentById.get(order.shipping.id)?.logisticType??null:null;
rows.push({...existingLine,logisticType});
```

Add `logisticType:null` to every test fixture that constructs `ShipmentCost`.

- [ ] **Step 5: Add a failing service test for the official shipment detail**

The mock must expect `GET /shipments/789`, return `{id:789,logistic:{type:'fulfillment'}}`, and assert that the persisted line has `logisticType === 'fulfillment'`. A 403 or 404 from only that detail request must leave `logisticType === null` while still saving shipment costs and order data.

- [ ] **Step 6: Fetch and validate shipment details independently**

Inside `enrich`, parse both current and legacy response shapes:

```ts
const detailSchema=z.object({
 id:remoteId,
 logistic:z.object({type:z.string().min(1).max(80).nullish()}).nullish(),
 logistic_type:z.string().min(1).max(80).nullish(),
});
const detail=detailSchema.parse(await get('/shipments/'+shipmentId));
if(detail.id!==shipmentId)throw new MeliError(502,'Não foi possível confirmar o envio.');
shipment.logisticType=detail.logistic?.type??detail.logistic_type??null;
```

Keep this call in its own `try/catch`: 403 and 404 leave the field unknown; timeout, 429 and upstream errors stay recoverable failures. The existing `x-format-new: true` header in `remote()` is retained.

- [ ] **Step 7: Run protocol and service tests**

Run: `node --test tests/meli.test.ts tests/meli-service.test.ts tests/meli-jobs.test.ts`

Expected: PASS, including partial enrichment and webhook retry behavior.

- [ ] **Step 8: Commit the logistics signal**

```bash
git add lib/allocation.ts lib/meli/protocol.ts lib/meli/service.ts lib/finance.ts tests/meli.test.ts tests/meli-service.test.ts tests/helpers/meli.ts
git commit -m "feat: capture Mercado Livre logistics type"
```

---

### Task 3: Resolve Full classification by sale, manual correction and offer rule

**Files:**
- Modify: `lib/finance.ts:1-35`
- Modify: `lib/reconciliation.ts:1-75`
- Modify: `app/api/reconciliation/route.ts:8-80`
- Modify: `tests/reconciliation-engine.test.ts:1-54`
- Modify: `tests/reconciliation.test.ts:1-28`

**Interfaces:**
- Produces: `Sale.operation?: { channel: 'full'|'other'|'unknown'; source: 'meli'|'manual'|'product'|'unknown'; conflict?: string }`.
- Extends: `ProductLinkPayload` to `{kind:'product'; sku:string; channel?:'full'|'other'|'unknown'}`.
- Produces: `resolveOperation(logisticType, manualChannel, productChannel): Sale['operation']`.
- Consumes: `Sale.logisticType` from Task 2.

- [ ] **Step 1: Write failing precedence and isolation tests**

```ts
test('envio oficial prevalece e divergência do anúncio fica visível',()=>{
 const operation=resolveOperation('fulfillment','other','other');
 assert.deepEqual(operation,{channel:'full',source:'meli',conflict:'A modalidade configurada diverge do envio do Mercado Livre.'});
});

test('duas ofertas do SKU 64265 mantêm operações diferentes',()=>{
 const full=applyReconciliation([saleFull],costs,[linkFull,linkCommon]);
 assert.equal(full[0].operation?.channel,'full');
 assert.equal(full[1].operation?.channel,'other');
 assert.equal(full[0].costSku,'64265');
 assert.equal(full[1].costSku,'64265');
});
```

Also cover `not_specified` as unknown, known non-Full types as `other`, a valid manual sale classification above the product default, and a stale manual adjustment that cannot classify the sale.

- [ ] **Step 2: Run reconciliation tests and verify failure**

Run: `node --test tests/reconciliation-engine.test.ts tests/reconciliation.test.ts`

Expected: FAIL because the derived operation and product channel do not exist.

- [ ] **Step 3: Implement `resolveOperation` and include logistics in the source stamp**

Known official common types are `drop_off`, `cross_docking`, `xd_drop_off`, `self_service`, `default` and `custom`. `fulfillment` maps to Full. Missing, `not_specified` and unrecognized values remain unknown. Compare the official result with explicit manual/product values and attach the conflict message without replacing the official value.

Add `logisticType` to `saleSourceStamp`, so a later official enrichment invalidates a conflicting manual confirmation.

- [ ] **Step 4: Apply operation only from valid sources**

In `applyReconciliation`:

1. choose the effective product link;
2. compute the source stamp;
3. apply the sale adjustment only when its stamp matches;
4. call `resolveOperation` with official type, valid manual channel and product channel;
5. preserve old product payloads by treating absent `channel` as `unknown`.

- [ ] **Step 5: Extend the reconciliation API contract**

Add optional `channel` to product `set`, defaulting to `unknown`. Persist `{kind:'product',sku,channel}`. Keep existing clients valid and retain account/item/variation/vigency/revision guards.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `node --test tests/reconciliation-engine.test.ts tests/reconciliation.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit classification behavior**

```bash
git add lib/finance.ts lib/reconciliation.ts app/api/reconciliation/route.ts tests/reconciliation-engine.test.ts tests/reconciliation.test.ts
git commit -m "feat: classify Full sales by logistics and offer"
```

---

### Task 4: Build the pure monthly closure engine

**Files:**
- Create: `lib/full-reconciliation.ts`
- Create: `tests/full-reconciliation.test.ts`
- Modify: `lib/finance.ts:1-45`

**Interfaces:**
- Consumes: reconciled `Sale[]`, `CostRecord[]`, and `allocateCents` from Tasks 2–3.
- Produces:

```ts
export type FullAllocation={saleId:string;units:number;expenseCents:number};
export type FullClosure={id:string;accountId:string;month:string;revision:number;action:'set'|'clear';totalExpenseCents:number|null;eligibleUnits:number;sourceStamp:string|null;reason:string;createdAt:string;stale?:boolean;allocations:FullAllocation[]};
export type FullPreview={eligible:Sale[];excluded:{saleId:string;reason:string}[];conflicts:string[];units:number};
export function previewFullMonth(sales:Sale[],costs:CostRecord[],accountId:string,month:string):FullPreview;
export function fullMonthSource(preview:FullPreview,costs:CostRecord[]):string;
export function allocateFullMonth(totalExpenseCents:number,preview:FullPreview):FullAllocation[];
export function applyFullClosures(sales:Sale[],closures:FullClosure[]):Sale[];
export function parseBrlCents(input:string):number|null;
```

- [ ] **Step 1: Write failing eligibility and exact-allocation tests**

Cover these concrete cases:

```ts
test('rateia dez mil reais em duzentas unidades e preserva o total',()=>{
 const preview=previewFullMonth(salesWithUnits([1,2,197]),costs,'a','2026-09');
 const allocations=allocateFullMonth(1_000_000,preview);
 assert.equal(preview.units,200);
 assert.equal(allocations.reduce((sum,row)=>sum+row.expenseCents,0),1_000_000);
 assert.equal(allocations[1].expenseCents,10_000);
});
```

Also assert stable odd-cent distribution, exclusion of common/pending/refunded/unknown-quantity lines, account/month isolation, same SKU in Full and common offers, and blocking conflict when `manual fullExpenseCents > 0`.

Add currency parsing cases for `R$ 10.000,00`, `0,01`, more than two decimal places, negative input, empty input and unsafe totals. Only valid non-negative amounts with at most two decimal places become cent integers.

- [ ] **Step 2: Run the new test and verify missing-module failure**

Run: `node --test tests/full-reconciliation.test.ts`

Expected: FAIL because the engine does not exist.

- [ ] **Step 3: Implement preview and deterministic source material**

Sort eligible sales by `sale.id`. Eligibility requires matching account/month, `status === 'paid'`, `operation.channel === 'full'`, and a positive integer `costQuantity`. Build `fullMonthSource` as stable JSON containing sale ID, date, units, operation source/type, `saleSourceStamp` material and selected cost ID. Do not include display labels.

- [ ] **Step 4: Implement allocation with the shared rateator**

```ts
const cents=allocateCents(totalExpenseCents,preview.eligible.map(sale=>sale.costQuantity!));
return preview.eligible.map((sale,index)=>({saleId:sale.id,units:sale.costQuantity!,expenseCents:cents[index]}));
```

Reject unsafe totals, zero eligible units and any manual Full conflict before allocating.

- [ ] **Step 5: Implement closed and provisional projection**

Extend `Sale` with:

```ts
fullExpense?:{cents:number;state:'estimated'|'closed';month:string;closureId?:string;unitRateCents:number};
fullClosureState?:'stale';
```

For each valid latest closure, apply its stored allocation. For an open month, find the latest earlier non-stale closure from the same account and estimate `Math.round(totalExpenseCents / eligibleUnits * sale.costQuantity)`. If there is no prior closure, set no value. A stale closure marks affected lines stale and does not apply new source data silently.

- [ ] **Step 6: Add projection tests**

Assert closed values replace estimates, another account is ignored, first month remains without estimate, prior unit rate creates `estimated`, and stale closure sets `fullClosureState === 'stale'` without reporting a final contribution.

- [ ] **Step 7: Run the engine suite**

Run: `node --test tests/full-reconciliation.test.ts tests/reconciliation.test.ts tests/finance.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the pure engine**

```bash
git add lib/full-reconciliation.ts lib/finance.ts tests/full-reconciliation.test.ts
git commit -m "feat: add monthly Full allocation engine"
```

---

### Task 5: Persist and expose monthly closing revisions

**Files:**
- Create: `lib/full-closure-store.ts`
- Create: `app/api/full-closures/route.ts`
- Modify: `db/schema.ts:1-14`
- Modify: `lib/meli/service.ts:10-12,143-153`
- Modify: `tests/migrations.test.ts`
- Modify: `tests/api.local.mjs:95-116`
- Generate: `drizzle/0007_monthly_full_closures.sql`
- Generate: `drizzle/meta/0007_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `GET /api/full-closures?accountId=<uuid>&month=YYYY-MM` returning `{preview,latest,history}`.
- Produces: `POST /api/full-closures` accepting:

```ts
type FullClosureCommand={
 action:'set'|'clear';requestId:string;accountId:string;month:string;
 expectedRevision:number;totalExpenseCents?:number;reason:string;
};
```

- Produces: `loadFullClosures(db,owner)` and `saveFullClosure(db,owner,command,projection)` in `lib/full-closure-store.ts`.

- [ ] **Step 1: Add migration assertions before creating schema**

In `tests/migrations.test.ts`, assert the final migrated database contains `full_closure_events`, `full_closure_allocations`, owner/request uniqueness, account/month/revision uniqueness, allocation `(closure_id,sale_id)` uniqueness, owner/account indexes and `meli_connections.logistics_version NOT NULL DEFAULT 1`.

- [ ] **Step 2: Run the migration test and verify failure**

Run: `node --test tests/migrations.test.ts`

Expected: FAIL because the tables and column do not exist.

- [ ] **Step 3: Add the Drizzle schema and generate one migration**

Schema shape:

```ts
export const fullClosureEvents=sqliteTable('full_closure_events',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),
 accountId:text('account_id').notNull().references(()=>accounts.id),month:text('month').notNull(),
 revision:integer('revision').notNull(),requestId:text('request_id').notNull(),action:text('action').notNull(),
 totalExpenseCents:integer('total_expense_cents'),eligibleUnits:integer('eligible_units').notNull(),
 sourceStamp:text('source_stamp'),reason:text('reason').notNull(),createdAt:text('created_at').notNull(),
},table=>[
 uniqueIndex('idx_full_closure_owner_request').on(table.ownerId,table.requestId),
 uniqueIndex('idx_full_closure_revision').on(table.ownerId,table.accountId,table.month,table.revision),
 index('idx_full_closure_owner_month').on(table.ownerId,table.accountId,table.month),
]);
```

Create `full_closure_allocations` with `closureId`, `ownerId`, `accountId`, `saleId`, `units`, `expenseCents`, a unique `(closureId,saleId)` index and owner/account index. Add `logisticsVersion` to `meliConnections`.

Run: `npx drizzle-kit generate --name monthly_full_closures`

Expected: creates exactly `drizzle/0007_monthly_full_closures.sql` and its snapshot. Inspect the SQL before continuing.

- [ ] **Step 4: Schedule one safe logistics reread**

Mirror the established gross-sales-version transition in `MeliService.sync`: when `logistics_version < 2`, atomically set it to `2`, clear `sync_cursor`, and mark the current run as needing history. Do not delete existing orders or reconciliation events. Add a service test proving the reset occurs once and later runs are incremental.

- [ ] **Step 5: Write failing API integration cases**

Extend `tests/api.local.mjs` with a fixture account containing Full/common lines. Assert:

- preview counts only eligible Full units;
- `set` creates exact allocations and replay returns `duplicate:true`;
- stale `expectedRevision` returns 409;
- foreign account returns 404 and wrong origin returns 403;
- manual positive Full expense returns 409 with an actionable message;
- `clear` creates a new revision and preserves prior records;
- allocation insert failure rolls back the header.

- [ ] **Step 6: Implement private loading and atomic save**

`saveFullClosure` must:

1. check an existing `(owner_id,request_id)` before work;
2. compute preview and `digest(fullMonthSource(...))` on the server;
3. allocate on the server, never trust client parcels;
4. insert the event with `INSERT ... SELECT ... WHERE expectedRevision=(SELECT COALESCE(MAX(...),0))`;
5. insert each allocation with owner/account/closure guards in the same `db.batch`;
6. check the header result and return 409 on a lost revision race;
7. return the persisted event.

- [ ] **Step 7: Implement GET preview and POST validation**

Use strict Zod limits: UUID request/account IDs, `YYYY-MM`, non-negative safe integer cents up to `1_000_000_000_000`, revision `0..1_000_000`, and reason `3..240`. Reuse `owner(request)` for same-origin mutation protection. Return only rows owned by the authenticated user.

- [ ] **Step 8: Run persistence and API tests**

Run: `node --test tests/migrations.test.ts tests/full-reconciliation.test.ts`

Then start the local server and run: `npm run test:api:local`

Expected: all migration and API cases pass; failed or concurrent writes leave no partial allocations.

- [ ] **Step 9: Commit storage and API**

```bash
git add db/schema.ts drizzle lib/meli/service.ts lib/full-closure-store.ts app/api/full-closures/route.ts tests/migrations.test.ts tests/meli-service.test.ts tests/api.local.mjs
git commit -m "feat: persist monthly Full closings"
```

---

### Task 6: Apply closures to every financial view without double deduction

**Files:**
- Modify: `lib/finance.ts:4-58`
- Modify: `lib/full-reconciliation.ts`
- Modify: `lib/demo.ts:1-16`
- Modify: `app/api/workspace/route.ts:1-18`
- Modify: `tests/finance.test.ts`
- Modify: `tests/reconciliation.test.ts`
- Modify: `tests/full-reconciliation.test.ts`
- Modify: `tests/api.local.mjs`

**Interfaces:**
- Consumes: latest closure revisions and allocations from Task 5.
- Produces: `Workspace.fullClosures: FullClosureSummary[]` and projected `Workspace.sales` with effective Full expense.
- Extends: `SaleResult` with `resultState:'pending'|'provisional'|'automatic'|'closed'|'manual'|'stale'`.

- [ ] **Step 1: Add failing financial calculation tests**

```ts
test('fechamento mensal substitui zero manual e deduz uma vez',()=>{
 const result=calculateSale({...manualSale,fullExpense:{cents:1500,state:'closed',month:'2026-09',closureId:'c1',unitRateCents:1500}},costs);
 assert.equal(result.fullExpenseCents,1500);
 assert.equal(result.contributionCents,10_000);
 assert.equal(result.resultState,'closed');
});
```

Also assert: provisional state, first Full month pending, positive manual Full wins only before closure, stale closure forces null contribution, and common automatic sale remains automatic.

- [ ] **Step 2: Run financial tests and verify failure**

Run: `node --test tests/finance.test.ts tests/reconciliation.test.ts tests/full-reconciliation.test.ts`

Expected: FAIL because calculation ignores projected Full expense/status.

- [ ] **Step 3: Centralize the effective Full expense**

In `calculateSale`, select one source:

```ts
const manualFull=sale.reconciliation?.state==='manual'?sale.reconciliation.amounts?.fullExpenseCents:null;
const projectedFull=sale.fullExpense?.cents;
const fullExpenseCents=projectedFull??manualFull;
```

The closure API already blocks `manualFull > 0`; calculation must still avoid addition of both values. Add the selected amount once to contribution and expose its origin through `saleBreakdownRows`.

- [ ] **Step 4: Verify closure freshness while building the workspace**

In `app/api/workspace/route.ts`:

1. load raw orders, costs, reconciliation events, closure events and allocations in the existing owner-scoped batch;
2. call `applyReconciliation`;
3. recompute each latest set closure's current source and SHA-256 digest;
4. mark mismatches stale;
5. call `applyFullClosures`;
6. return projected sales and closure summaries with `Cache-Control: private, no-store`.

- [ ] **Step 5: Add the integrated regression for the user's saved reconciliation**

In `tests/api.local.mjs`, after saving a complete manual adjustment, fetch `/api/workspace` again and calculate/inspect the returned sale. Assert its contribution changed, its status is manual, and a subsequent fresh request preserves the same values. Then close a Full month and assert the workspace response contains the closed parcel and changed contribution.

- [ ] **Step 6: Run domain and local API tests**

Run: `npm test`

Then with the local server: `npm run test:api:local`

Expected: all tests pass and the saved values are visible on the very next post-mutation load.

- [ ] **Step 7: Commit unified financial projection**

```bash
git add lib/finance.ts lib/full-reconciliation.ts lib/demo.ts app/api/workspace/route.ts tests/finance.test.ts tests/reconciliation.test.ts tests/full-reconciliation.test.ts tests/api.local.mjs
git commit -m "feat: apply Full closings to financial results"
```

---

### Task 7: Add product logistics and monthly closing interfaces

**Files:**
- Create: `components/full-closure-panel.tsx`
- Create: `components/product-logistics-dialog.tsx`
- Modify: `components/commerce-app.tsx:9-29`
- Modify: `components/reconciliation-view.tsx:9-74`
- Modify: `components/finance-views.tsx`
- Modify: `app/globals.css:107-110`
- Modify: `lib/demo.ts`

**Interfaces:**
- Consumes: `Workspace.fullClosures`, `Sale.operation`, `Sale.fullExpense`, product-link reconciliation events, and `refresh()` from Task 1.
- Produces: product-offer configuration and monthly close/clear actions through existing `/api/reconciliation` and new `/api/full-closures`.

- [ ] **Step 1: Implement the product-offer dialog from server-derived rows**

`ProductLogisticsDialog` receives one account/SKU product and builds unique `(itemId,variationId)` rows from real sales. Each row shows effective operation, source, conflict, current cost link and vigency. The form posts:

```ts
{
 kind:'product',action:'set',requestId:crypto.randomUUID(),accountId,
 itemId,variationId,validFrom,expectedRevision,sku,
 channel:'unknown'|'full'|'other',reason
}
```

Use labels `Detectar pelo Mercado Livre`, `Mercado Livre Full` and `Venda comum`. Disable mutation in demonstration mode. After success, await the forced `refresh()` and then show the toast.

- [ ] **Step 2: Expose the dialog in Produtos**

Add an `Operação` column and `Configurar anúncios` action in `ProductsView`. A SKU with mixed offers shows `Full e comum`; conflicts show `Revisar`. Continue grouping financial totals by account/SKU and never merge equal SKUs from different accounts.

- [ ] **Step 3: Implement the monthly preview panel**

`FullClosurePanel` contains exact account and month selectors, fetches `GET /api/full-closures`, and displays eligible sales, units, exclusions, previous unit rate, estimated total and latest status. The close form accepts a Brazilian currency string, converts it with `parseBrlCents` from Task 4, requires a reason and posts a UUID request ID with the expected revision.

- [ ] **Step 4: Implement confirmation and history behavior**

Before POST `set`, show total, units and average per unit. Disable closing for zero eligible units or conflicts. Show `Aberto`, `Provisório`, `Fechado` and `Revisar`. A `Retirar fechamento` action posts `clear`, preserves history and requires a reason. Network failure keeps every typed value.

- [ ] **Step 5: Update financial labels and details**

In Overview, Sales and Products:

- mark contribution `Provisória` when any included row uses an estimate;
- show `Fechada` for a closed Full parcel;
- show `A conferir` for stale or missing first-month expense;
- render `Despesa Full estimada` or `Despesa Full fechada` as a separate breakdown row;
- show month, origin and average unit rate in the sale detail.

- [ ] **Step 6: Add responsive and accessible styling**

Use existing panel, table, dialog, badge and focus patterns. At widths below 960px stack monthly metrics into two columns; below 640px use one column, full-width controls and scrollable tables. Associate every input with a visible label, preserve keyboard close/focus behavior, and use text in addition to badge color.

- [ ] **Step 7: Run static verification**

Run: `npx tsc --noEmit && npm run build`

Expected: PASS with no client/server type leakage.

- [ ] **Step 8: Commit the interfaces**

```bash
git add components/full-closure-panel.tsx components/product-logistics-dialog.tsx components/commerce-app.tsx components/reconciliation-view.tsx components/finance-views.tsx app/globals.css lib/demo.ts
git commit -m "feat: add Full closing workflow"
```

---

### Task 8: Verify, document and publish the complete increment

**Files:**
- Modify: `README.md`
- Modify as failures require: files owned by Tasks 1–7 only

**Interfaces:**
- Consumes: complete feature from Tasks 1–7.
- Produces: published private Sites version and verified production migration.

- [ ] **Step 1: Document the operator workflow**

Add concise README instructions:

1. link each Mercado Livre offer/variation to the Citel SKU;
2. leave logistics on automatic or mark the offer Full/common when official data is unavailable;
3. follow provisional Full margin during the open month;
4. paste the monthly total in Conciliação;
5. review units/exclusions and close;
6. reopen/revise when a return or source change creates `Revisar`.

State that no new cost spreadsheet is required unless cost/tax/vigency itself changed.

- [ ] **Step 2: Run the complete automated suite once**

Run: `npm test && npx tsc --noEmit && npm run build`

Expected: every unit/integration test, typecheck and production build passes.

- [ ] **Step 3: Run local API and worker suites**

Start the built local server with the project's existing fixture procedure, then run:

```bash
npm run test:api:local
npm run test:worker:local
node --test tests/meli-events-worker.local.mjs
```

Expected: all API, authentication, owner isolation, event bridge and queue tests pass.

- [ ] **Step 4: Perform desktop browser QA**

Using the real local workspace fixture:

- save a complete manual reconciliation while polling is active and confirm the next screen state changes immediately;
- configure SKU 64265 with one Full and one common offer;
- verify only Full units enter the preview;
- close a month with an odd-cent total and compare UI sum to input;
- confirm Overview, Vendas and Produtos show the same contribution;
- trigger a post-close quantity/status change and verify `Revisar`.

Capture console and network errors; fix any product-code defect and rerun only the affected checks plus the full final suite once.

- [ ] **Step 5: Perform mobile and accessibility QA**

At 390×844, verify navigation, product dialog, monthly panel, confirmation, history and sale detail without clipped controls or horizontal page overflow. Tab through inputs/buttons and confirm labels, focus visibility and dialog return focus.

- [ ] **Step 6: Request an independent code review**

Use `superpowers:requesting-code-review` against the complete branch. Resolve verified high/medium findings using `superpowers:receiving-code-review`, then rerun affected tests.

- [ ] **Step 7: Run final verification immediately before publishing**

Use `superpowers:verification-before-completion` and rerun:

```bash
npm test
npx tsc --noEmit
npm run build
git diff --check
git status --short
```

Expected: green output, no unexpected working-tree changes, and only the intended README or review fixes waiting to commit.

- [ ] **Step 8: Commit documentation and review fixes**

```bash
git add README.md
git add -u
git commit -m "docs: explain monthly Full closing"
```

- [ ] **Step 9: Publish with Sites and verify production**

Follow the current `sites:sites-building` and `sites:sites-hosting` skills. Push the source branch to the Site repository, publish the private Site, confirm migration `0007_monthly_full_closures.sql` succeeded, then inspect the production workspace and Full preview without exposing private sale data in logs.

- [ ] **Step 10: Smoke-test the deployed workflow**

On `https://central-vendas-lucas.kisashi.chatgpt.site`, verify authenticated loading, offer configuration, a non-destructive monthly preview, immediate post-save refresh, existing dashboard values and browser console/network health. Do not create a real monthly closing merely for a smoke test; use production read-only preview unless the user has already entered the real demonstrative total.
