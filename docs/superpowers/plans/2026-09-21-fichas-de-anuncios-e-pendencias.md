# Fichas de anúncios e pendências automáticas — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a conciliação diária por fichas financeiras versionadas por anúncio, dados automáticos do Mercado Livre, pendências pontuais e fechamento Full mensal preservado.

**Architecture:** A projeção financeira passará a resolver quatro fontes independentes: pedido oficial, ficha do anúncio, fechamento Full e correção excepcional por campo. Novas tabelas append-only armazenam fichas e correções; o catálogo de anúncios é sincronizado separadamente dos pedidos. Uma migração com comparação por venda converte os dados atuais antes de ativar a nova leitura, mantendo o legado intacto para auditoria e reversão.

**Tech Stack:** TypeScript, React 19, Vinext/Vite, Cloudflare Workers, D1/Drizzle, Node test runner, Zod, Radix UI, Mercado Livre API, Cloudflare Worker de eventos e Sites.

**Spec:** `docs/superpowers/specs/2026-09-21-fichas-de-anuncios-e-pendencias-design.md`

## Global Constraints

- Conta, anúncio e variação são isolados por proprietário; nenhuma chave pode depender somente de SKU ou título.
- O fuso comercial é `America/Sao_Paulo`; vigências são datas `YYYY-MM-DD` nesse calendário.
- Campos financeiros ausentes permanecem `null`; zero só vale quando declarado ou confirmado pela API.
- Custo unitário suporta quatro casas decimais e só arredonda para centavos depois de multiplicar a quantidade.
- A API do Mercado Livre é a fonte prioritária de receita, comissão, frete, descontos, status e logística.
- Ficha do anúncio é a única fonte normal de custo e imposto depois do corte.
- Operação Full/comum da ficha só substitui modalidade desconhecida; logística oficial sempre prevalece.
- Fechamentos Full, eventos legados, planilhas e documentos existentes nunca são apagados pela migração.
- Toda mutação exige proprietário, mesma origem, idempotência e revisão esperada.
- A interface privada preserva o acesso atual; o incremento não altera permissões do Mercado Livre nem do Site.

## Review Focus

- `variationId=null` precisa gerar chave estável e string vazia deve ser rejeitada antes da persistência; Task 1 fixa isso em teste.
- Custo/imposto zero não pode ser confundido com campo vazio; Task 1 cobre parsing, cálculo e motivos pendentes.
- Correção temporária seguida por valor oficial deve usar o oficial sem dupla dedução; override de valor oficial alterado deve ficar Revisar; Task 1 cobre os dois caminhos.
- Migração com duas versões de custo na mesma vigência deve usar o desempate atual e registrar conflito quando a origem não é única; Task 4 cobre esse caso.
- Sincronização de catálogo interrompida, repetida ou concorrente não pode apagar anúncios nem misturar contas; Task 3 cobre retomada, idempotência e guarda de geração.

---

### Task 1: Criar o domínio puro de fichas, correções e origem dos valores

**Files:**
- Create: `lib/ad-profiles.ts`
- Create: `lib/sale-corrections.ts`
- Create: `lib/sale-projection.ts`
- Create: `tests/ad-profiles.test.ts`
- Create: `tests/sale-corrections.test.ts`
- Modify: `lib/finance.ts`
- Modify: `tests/finance.test.ts`

**Interfaces:**
- Consumes: `Sale`, `SaleOperation` e `SaleResult` de `lib/finance.ts`; `resolveOperation` de `lib/reconciliation.ts`; `businessDate` de `lib/dates.ts`.
- Produces:

```ts
export type TaxRule=
 | {mode:'included'}
 | {mode:'unit';valueTenThousandths:number}
 | {mode:'percent';rateBasisPoints:number};
export type OperationOverride='auto'|'full'|'other';
export type AdProfilePayload={unitCostTenThousandths:number;tax:TaxRule;operation:OperationOverride};
export type AdProfileEvent={
 id:string;accountId:string;itemId:string;variationId:string|null;validFrom:string;
 revision:number;action:'set'|'clear';payload:AdProfilePayload|null;requestId:string;
 reason:string;origin:'native'|'legacy';createdAt:string;
};
export function adTargetKey(itemId:string,variationId:string|null|undefined):string;
export function activeAdProfile(events:AdProfileEvent[],sale:Sale):AdProfileEvent|undefined;
export function latestAdProfile(events:AdProfileEvent[],accountId:string,itemId:string,variationId?:string|null):AdProfileEvent|undefined;
```

```ts
export type CorrectableField='revenueCents'|'feeCents'|'shippingCents'|'otherCents'|'costQuantity';
export type SaleCorrectionEvent={
 id:string;accountId:string;saleId:string;field:CorrectableField;revision:number;
 action:'set'|'clear';mode:'fallback'|'override';value:number|null;sourceValue:number|null;
 sourceStamp:string;requestId:string;reason:string;createdAt:string;
};
export function applySaleCorrections(sale:Sale,events:SaleCorrectionEvent[]):Sale;
export type FinancialSource='meli'|'ad_profile'|'full_estimate'|'full_closure'|'manual_fallback'|'manual_override';
export function applyAdProfiles(sales:Sale[],profiles:AdProfileEvent[]):Sale[];
```

- [ ] **Step 1: Escrever testes falhando para seleção e cálculo da ficha**

Criar casos com duas contas, dois anúncios e duas variações do SKU 64265. Fixar estes resultados:

```ts
assert.equal(adTargetKey('MLB1',null),'["MLB1",null]');
assert.throws(()=>adTargetKey('MLB1',''));
assert.equal(activeAdProfile(events,{...sale,date:'2026-09-20'})?.revision,2);
assert.equal(calculateSale(applyAdProfiles([sale],profiles)[0],[]).costCents,20001);
```

Cobrir custo `100.0050` para duas unidades, imposto incluído, imposto unitário, percentual, zero declarado, campo ausente, vigência futura, revisão `clear`, conta diferente e variação diferente.

- [ ] **Step 2: Executar os testes e confirmar a falha esperada**

Run: `node --test tests/ad-profiles.test.ts tests/finance.test.ts`

Expected: FAIL por ausência de `lib/ad-profiles.ts` e de suporte a `sale.adProfile`.

- [ ] **Step 3: Implementar seleção imutável e cálculo exato da ficha**

Adicionar a `Sale`:

```ts
adProfile?:{eventId:string;revision:number;validFrom:string;unitCostTenThousandths:number;tax:TaxRule};
fieldSources?:Partial<Record<'revenueCents'|'feeCents'|'shippingCents'|'otherCents'|'costQuantity'|'costCents'|'taxCents'|'fullExpenseCents',FinancialSource>>;
```

Em `calculateSale`, usar `sale.adProfile` como fonte primária. Calcular custo com `Math.round(unitCostTenThousandths*costQuantity/100)`, imposto unitário com a mesma escala e imposto percentual com `Math.round(revenueCents*rateBasisPoints/10_000)`. Manter o caminho de `CostRecord` somente para a comparação de migração da Task 4.

- [ ] **Step 4: Escrever testes falhando para correções pontuais**

```ts
assert.equal(applySaleCorrections({...sale,shippingCents:null},[fallback]).shippingCents,1250);
assert.equal(applySaleCorrections({...sale,shippingCents:900},[fallback]).shippingCents,900);
assert.equal(applySaleCorrections({...sale,feeCents:1300},[override]).feeCents,1200);
assert.equal(applySaleCorrections({...sale,feeCents:1400},[override]).correctionState,'stale');
```

Também testar campo errado, conta errada, maior revisão fora de ordem e evento `clear`.

- [ ] **Step 5: Implementar correções e mapa de origens**

`fallback` só substitui `null`. `override` exige `sourceValue` igual ao valor oficial atual; divergência marca `correctionState:'stale'`. Eventos `clear` removem somente o campo correspondente. `applyAdProfiles` anexa a ficha e resolve a operação, convertendo `operation:'auto'` em canal desconhecido para que a logística oficial tenha precedência.

- [ ] **Step 6: Executar a suíte de domínio**

Run: `node --test tests/ad-profiles.test.ts tests/sale-corrections.test.ts tests/finance.test.ts tests/reconciliation-engine.test.ts`

Expected: PASS.

- [ ] **Step 7: Commitar o domínio puro**

```bash
git add lib/ad-profiles.ts lib/sale-corrections.ts lib/sale-projection.ts lib/finance.ts tests/ad-profiles.test.ts tests/sale-corrections.test.ts tests/finance.test.ts
git commit -m "feat: add versioned ad financial profiles"
```

---

### Task 2: Persistir fichas e correções com APIs privadas

**Files:**
- Modify: `db/schema.ts`
- Create: `lib/ad-profile-store.ts`
- Create: `lib/sale-correction-store.ts`
- Create: `app/api/ad-profiles/route.ts`
- Create: `app/api/sale-corrections/route.ts`
- Modify: `tests/migrations.test.ts`
- Modify: `tests/api.local.mjs`
- Generate: `drizzle/0008_ad_profiles.sql`
- Generate: `drizzle/meta/0008_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: tipos da Task 1 e helpers privados de `lib/server.ts`.
- Produces:

```ts
export async function loadAdProfiles(db:D1Database,ownerId:string):Promise<AdProfileEvent[]>;
export async function saveAdProfile(db:D1Database,ownerId:string,command:AdProfileCommand):Promise<{event:AdProfileEvent;duplicate:boolean}>;
export async function loadSaleCorrections(db:D1Database,ownerId:string):Promise<SaleCorrectionEvent[]>;
export async function saveSaleCorrection(db:D1Database,ownerId:string,command:SaleCorrectionCommand,currentSale:Sale):Promise<{event:SaleCorrectionEvent;duplicate:boolean}>;
```

`POST /api/ad-profiles` recebe `action`, `requestId`, conta, item, variação, vigência, `expectedRevision`, payload e motivo. `POST /api/sale-corrections` recebe uma única venda, `field`, `mode`, valor, fonte atual, assinatura, revisão e motivo.

- [ ] **Step 1: Adicionar testes de migração antes do schema**

Exigir `ad_profile_events`, `sale_correction_events`, `meli_listings`, `meli_catalog_runs`, `ad_profile_rollouts`, os índices únicos e `meli_connections.financials_version NOT NULL DEFAULT 1`.

```ts
assert.ok(tables.includes('ad_profile_events'));
assert.ok(tables.includes('sale_correction_events'));
assert.ok(tables.includes('meli_listings'));
assert.ok(tables.includes('meli_catalog_runs'));
assert.ok(tables.includes('ad_profile_rollouts'));
assert.ok(profileIndexes.includes('idx_ad_profiles_target_revision'));
assert.ok(correctionIndexes.includes('idx_sale_corrections_target_revision'));
```

- [ ] **Step 2: Executar teste e verificar falha**

Run: `node --test tests/migrations.test.ts`

Expected: FAIL porque as tabelas não existem.

- [ ] **Step 3: Definir schema e gerar a migração**

`ad_profile_events` guarda item, variação nula normalizada para `''` depois de a API rejeitar string vazia, vigência, revisão, ação, payload JSON canônico, origem e auditoria. `sale_correction_events` guarda venda, campo, revisão, modo, valor, fonte, assinatura e auditoria. `meli_listings` guarda conta/item/variação, título, status, SKU do vendedor e atualização; `meli_catalog_runs` guarda geração, offset, total, status e lease; `ad_profile_rollouts` guarda estado, assinatura, relatório e ativação por proprietário. Adicionar `financials_version` à conexão para uma releitura histórica única. Todas as FKs e consultas incluem proprietário/conta.

Run: `npx drizzle-kit generate --name ad_profiles`

Expected: somente `0008_ad_profiles.sql`, snapshot e journal mudam.

- [ ] **Step 4: Escrever casos de API falhando**

Em `tests/api.local.mjs`, testar login, mesma origem, outro dono, variação nula, custo zero, payload inválido, idempotência, revisão concorrente, cópia na mesma conta e recusa entre contas. Para correções, validar venda pelo proprietário, campo, fonte atual, fallback somente para `null`, motivo obrigatório e inteiros não negativos.

- [ ] **Step 5: Implementar stores e rotas**

Validar com Zod e usar `INSERT ... SELECT ... WHERE expectedRevision=(SELECT COALESCE(MAX(revision),0)...)`. Reenvio relê pelo `request_id`. O servidor consulta anúncio, venda e conta; nunca confia apenas nos identificadores do cliente.

- [ ] **Step 6: Executar persistência e API**

Run: `node --test tests/migrations.test.ts tests/ad-profiles.test.ts tests/sale-corrections.test.ts`

Run: `npm run test:api:local`

Expected: PASS.

- [ ] **Step 7: Commitar persistência**

```bash
git add db/schema.ts drizzle lib/ad-profile-store.ts lib/sale-correction-store.ts app/api/ad-profiles/route.ts app/api/sale-corrections/route.ts tests/migrations.test.ts tests/api.local.mjs
git commit -m "feat: persist ad profiles and sale corrections"
```

---

### Task 3: Completar dados oficiais e sincronizar o catálogo do Mercado Livre

**Files:**
- Create: `lib/meli/catalog.ts`
- Create: `lib/meli/discounts.ts`
- Modify: `lib/meli/protocol.ts`
- Modify: `lib/meli/service.ts`
- Modify: `lib/meli/jobs.ts`
- Modify: `lib/meli/internal.ts`
- Modify: `tests/helpers/meli.ts`
- Modify: `tests/meli.test.ts`
- Modify: `tests/meli-service.test.ts`
- Modify: `tests/meli-jobs.test.ts`

**Interfaces:**
- Consumes: tabelas e `financials_version` criados na Task 2, `MeliService.remote`, token, leases e guardas de geração existentes.
- Produces:

```ts
export type MeliListing={id:string;accountId:string;itemId:string;variationId:string|null;title:string;status:string;sellerSku:string|null;updatedAt:number};
export function parseCatalogPage(search:unknown,items:unknown,accountId:string):MeliListing[];
MeliService.syncCatalog(ownerId:string,accountId:string,expectedGeneration?:string):Promise<{status:'running'|'complete';processed:number;total:number}>;
```

- [ ] **Step 1: Escrever testes falhando para dados financeiros oficiais e catálogo**

Para descontos, validar a resposta de `/orders/:id/discounts`, separar a parcela paga pelo vendedor, manter subsídio do Mercado Livre fora das despesas e produzir `otherCents` conhecido quando todos os detalhes forem conclusivos. Resposta ausente ou ambígua continua `null`; nunca usar zero. Cobrir também anúncio sem variação, duas variações, SKU ausente, status pausado, resposta malformada, item de outro vendedor e chave por conta/variação.

- [ ] **Step 2: Escrever testes falhando para retomada**

Simular duas páginas e falha após a primeira. Confirmar idempotência, offset salvo, proteção de geração e isolamento.

```ts
assert.equal(sqlite.prepare('SELECT count(*) n FROM meli_listings').get()?.n,3);
assert.equal(sqlite.prepare("SELECT offset FROM meli_catalog_runs WHERE account_id='a'").get()?.offset,2);
```

- [ ] **Step 3: Implementar enriquecimento financeiro e releitura única**

Criar parser estrito em `lib/meli/discounts.ts`. `normalizeOrders` recebe o custo promocional do vendedor em centavos e mantém receita dos itens separada. Quando `financials_version<2`, o sincronizador muda atomicamente para `2`, limpa o cursor e agenda uma releitura histórica uma única vez, seguindo o padrão já testado de `grossSalesVersion` e `logisticsVersion`.

- [ ] **Step 4: Implementar parser e sincronização protegida**

Buscar IDs do vendedor em páginas e detalhes em lotes, validar com Zod e gravar página+offset atomicamente. Marcar anúncios antigos como inativos somente depois de uma varredura completa; falha parcial nunca remove catálogo.

- [ ] **Step 5: Integrar com a fila automática**

Ao concluir uma janela de pedidos, enfileirar `catalog` para conta e geração. `MeliJobs.process` chama `syncCatalog`; a recuperação periódica converge sem duplicar trabalhos.

- [ ] **Step 6: Executar testes do Mercado Livre**

Run: `node --test tests/meli.test.ts tests/meli-service.test.ts tests/meli-jobs.test.ts tests/meli-events.test.ts tests/meli-internal.test.ts`

Expected: PASS.

- [ ] **Step 7: Commitar catálogo**

```bash
git add lib/meli/catalog.ts lib/meli/discounts.ts lib/meli/protocol.ts lib/meli/service.ts lib/meli/jobs.ts lib/meli/internal.ts tests/helpers/meli.ts tests/meli.test.ts tests/meli-service.test.ts tests/meli-jobs.test.ts
git commit -m "feat: enrich Mercado Livre sales and listings"
```

---

### Task 4: Migrar dados legados com comparação por venda

**Files:**
- Create: `lib/ad-profile-migration.ts`
- Create: `app/api/ad-profile-migration/route.ts`
- Create: `tests/ad-profile-migration.test.ts`
- Modify: `tests/api.local.mjs`

**Interfaces:**
- Consumes: custos/imports, eventos de reconciliação, vendas brutas, fichas/correções e cálculo legado.
- Produces:

```ts
export type MigrationIssue={accountId:string;itemId:string;variationId:string|null;code:'missing_cost'|'unknown_tax'|'ambiguous_cost'|'projection_difference';message:string};
export type MigrationPlan={sourceStamp:string;profiles:AdProfileEvent[];issues:MigrationIssue[];comparedSales:number;blockingDifferences:number};
export function buildAdProfileMigration(input:LegacyWorkspace):MigrationPlan;
export async function activateAdProfileMigration(db:D1Database,ownerId:string,expectedSourceStamp:string):Promise<MigrationPlan>;
```

- [ ] **Step 1: Escrever matriz de migração falhando**

Cobrir vínculo+custo, duas vigências, SKU exato único, SKU ambíguo, import retirado, desempate de mesma vigência, imposto desconhecido, SKU 64265 Full/comum, ajuste legado preservado na camada histórica, fechamento Full preservado e diferença bloqueadora.

- [ ] **Step 2: Executar teste e confirmar falha**

Run: `node --test tests/ad-profile-migration.test.ts`

Expected: FAIL por módulo ausente.

- [ ] **Step 3: Implementar planejador determinístico**

Converter decimais para dez-milésimos, criar `origin:'legacy'`, nunca casar por título/preço e assinar todas as fontes. Projetar cada venda pelos motores antigo e novo, comparando custo, imposto, operação, contribuição e estado.

- [ ] **Step 4: Persistir rollout na estrutura criada pela Task 2**

Usar `ad_profile_rollouts(owner_id PRIMARY KEY,state,source_stamp,report,activated_at,updated_at)` com estados `pending`, `blocked`, `active`. A ativação grava fichas e rollout em uma transação; os ajustes completos de vendas já existentes continuam nos eventos legados e só afetam aquelas vendas históricas. Diferença bloqueadora grava relatório e não ativa. Proprietário sem legado ativa um rollout vazio e passa diretamente ao fluxo novo.

- [ ] **Step 5: Implementar API de prévia e ativação**

`GET /api/ad-profile-migration` retorna contagens e issues do usuário. `POST` recebe `{requestId,expectedSourceStamp}`, recalcula no servidor, é idempotente e responde 409 quando a fonte mudou.

- [ ] **Step 6: Executar migração e API**

Run: `node --test tests/ad-profile-migration.test.ts`

Run: `npm run test:api:local`

Expected: PASS, incluindo rollback e isolamento.

- [ ] **Step 7: Commitar migração**

```bash
git add lib/ad-profile-migration.ts app/api/ad-profile-migration/route.ts tests/ad-profile-migration.test.ts tests/api.local.mjs
git commit -m "feat: migrate legacy costs into ad profiles"
```

---

### Task 5: Ativar a projeção nova e gerar Pendências

**Files:**
- Create: `lib/pending.ts`
- Create: `tests/pending.test.ts`
- Modify: `lib/sale-projection.ts`
- Modify: `lib/finance.ts`
- Modify: `lib/full-reconciliation.ts`
- Modify: `lib/full-closure-store.ts`
- Modify: `app/api/workspace/route.ts`
- Modify: `app/api/full-closures/route.ts`
- Modify: `lib/demo.ts`
- Modify: `tests/finance.test.ts`
- Modify: `tests/full-reconciliation.test.ts`
- Modify: `tests/api.local.mjs`

**Interfaces:**
- Consumes: fichas, correções, rollout, catálogo, vendas e fechamentos.
- Produces:

```ts
export type PendingKind='missing_profile'|'missing_cost'|'missing_tax'|'missing_meli_field'|'unknown_operation'|'missing_full_reference'|'stale_correction'|'stale_full_closure'|'migration_conflict';
export type PendingItem={id:string;kind:PendingKind;accountId:string;saleId?:string;itemId?:string;variationId?:string|null;field?:CorrectableField;title:string;message:string;action:'edit_profile'|'correct_sale'|'review_full'|'review_migration'};
export function collectPending(input:{sales:SaleResult[];listings:MeliListing[];migrationIssues:MigrationIssue[]}):PendingItem[];
```

`Workspace` passa a devolver `listings`, `adProfiles`, `saleCorrections`, `pending` e `rollout`.

- [ ] **Step 1: Escrever testes falhando por tipo de pendência**

Criar caso para cada `PendingKind`, zero declarado, anúncio sem venda, venda sem `itemId`, primeiro mês Full, correção stale e conflito de migração. IDs devem permanecer iguais após refresh.

- [ ] **Step 2: Escrever teste integrado de projeção**

Montar venda com ficha, API completa e fechamento Full. Confirmar a mesma contribuição em resumo, venda e anúncio. Remover cada fonte e verificar margem `null` com motivo preciso.

- [ ] **Step 3: Implementar pipeline único**

```ts
const legacy=applyReconciliation(rawSales,legacyCosts,legacyEvents);
const corrected=legacy.map(sale=>applySaleCorrections(sale,corrections));
const profiled=applyAdProfiles(corrected,profiles);
const withFull=applyFullClosures(profiled,closures);
const results=withFull.map(sale=>calculateSale(sale,[]));
```

Quando `rollout.state==='active'`, fichas substituem custos/vínculos legados nas vendas automáticas; `legacyCosts` e eventos `targetType:'sale'` continuam disponíveis somente para reproduzir ajustes completos criados antes do corte. Em `pending/blocked`, manter integralmente a projeção antiga. A assinatura Full inclui ficha e correções materiais.

- [ ] **Step 4: Atualizar workspace e fechamento Full**

Carregar fontes por proprietário e retornar resumos mínimos. A API Full usa a projeção ativa e preserva prevenção de dupla dedução.

- [ ] **Step 5: Atualizar demonstração**

Gerar catálogo e fichas demo completas, uma pendência e um anúncio Full. A demonstração não depende de planilha nem de conciliação.

- [ ] **Step 6: Executar domínio e API**

Run: `node --test tests/pending.test.ts tests/ad-profiles.test.ts tests/sale-corrections.test.ts tests/finance.test.ts tests/full-reconciliation.test.ts tests/reconciliation.test.ts`

Run: `npm run test:api:local`

Expected: PASS.

- [ ] **Step 7: Commitar projeção**

```bash
git add lib/pending.ts lib/sale-projection.ts lib/finance.ts lib/full-reconciliation.ts lib/full-closure-store.ts app/api/workspace/route.ts app/api/full-closures/route.ts lib/demo.ts tests
git commit -m "feat: project sales from ads and automatic sources"
```

---

### Task 6: Construir a área Anúncios e a ficha financeira

**Files:**
- Create: `components/ad-profiles-view.tsx`
- Create: `components/ad-profile-dialog.tsx`
- Modify: `components/commerce-app.tsx`
- Modify: `components/finance-views.tsx`
- Modify: `components/commerce-controls.tsx` only if a shared control is required
- Modify: `app/globals.css`
- Modify: `lib/demo.ts`

**Interfaces:**
- Consumes: catálogo, fichas, vendas, contas, `POST /api/ad-profiles` e `onReload` coordenado.
- Produces: `AdProfilesView` e `AdProfileDialog` com edição, cópia, prévia e histórico.

- [ ] **Step 1: Trocar navegação em demonstração**

Substituir `products` por `ads` e hash `#ads`. `#products` redireciona para `#ads` durante a transição. Manter a view antiga sem uso até a Task 8.

- [ ] **Step 2: Implementar lista de anúncios**

Agrupar variações; mostrar conta, operação, custo, imposto, vigência, atualização e estado. Adicionar busca e filtros `Todos`, `Completos`, `Pendentes`. Estados usam texto além de cor.

- [ ] **Step 3: Implementar diálogo da ficha**

Campos exatos:

```ts
unitCost:string;
taxMode:'included'|'unit'|'percent';
taxValue:string;
operation:'auto'|'full'|'other';
validFrom:string;
reason:string;
```

Parser aceita vírgula, zero e quatro casas; percentual entre 0 e 100. Ocultar valor quando incluído. Avisar sobre vigência passada.

- [ ] **Step 4: Implementar cópia segura**

Listar somente fichas da mesma conta. Copiar custo e imposto, nunca operação, vigência ou alvo. Exigir Salvar depois da prévia.

- [ ] **Step 5: Implementar histórico e prévia**

Mostrar revisão, origem `Dados anteriores`/`Cadastro`, motivo e vigência. Prévia usa última venda sem persistir.

- [ ] **Step 6: Fazer QA local da tela**

Conferir anúncio sem variação, duas variações, SKU 64265, cópia, três modos de imposto, formato inválido, vigência passada, recarga após salvar e retorno de foco. Em 390×844, confirmar ausência de overflow.

- [ ] **Step 7: Commitar Anúncios**

```bash
git add components/ad-profiles-view.tsx components/ad-profile-dialog.tsx components/commerce-app.tsx components/finance-views.tsx components/commerce-controls.tsx app/globals.css lib/demo.ts
git commit -m "feat: add ad financial profile workspace"
```

---

### Task 7: Substituir Conciliação por Pendências e separar Despesas Full

**Files:**
- Create: `components/pending-view.tsx`
- Create: `components/sale-correction-dialog.tsx`
- Create: `components/full-expenses-view.tsx`
- Modify: `components/full-closure-panel.tsx`
- Modify: `components/commerce-app.tsx`
- Modify: `components/finance-views.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: pendências, vendas projetadas, `POST /api/sale-corrections`, fechamentos e navegação para Anúncios/Full.
- Produces: `PendingView`, `SaleCorrectionDialog` e `FullExpensesView`.

- [ ] **Step 1: Criar lista de Pendências**

Ordenar Revisar antes de Ausente. Cada item mostra problema, conta, anúncio/pedido e uma ação: Configurar anúncio, Informar campo, Revisar correção, Fechar mês Full ou Revisar migração.

- [ ] **Step 2: Implementar correção de um campo**

Se oficial for `null`, salvar `fallback`; se o usuário corrigir valor oficial, salvar `override`, mostrar ambos e exigir motivo. Nunca renderizar a composição inteira.

- [ ] **Step 3: Exibir fontes no detalhe da venda**

Mostrar Mercado Livre, Ficha do anúncio, Estimativa Full, Fechamento Full ou Correção em cada linha. Override stale mostra Revisar e bloqueia contribuição.

- [ ] **Step 4: Mover fechamento para Despesas Full**

Envolver `FullClosurePanel` em página própria com conta, mês, total, unidades, média, exclusões e histórico. Remover linguagem de conciliação sem mudar rateio/API.

- [ ] **Step 5: Atualizar navegação e badge**

Substituir `reconciliation` por `pending`, adicionar `full-expenses` e contador. `#reconciliation` redireciona para `#pending`.

- [ ] **Step 6: Fazer QA do fluxo**

Testar fallback seguido de oficial, override seguido de mudança, fechamento Full ímpar e consistência com visão geral. Validar foco e celular.

- [ ] **Step 7: Commitar Pendências e Full**

```bash
git add components/pending-view.tsx components/sale-correction-dialog.tsx components/full-expenses-view.tsx components/full-closure-panel.tsx components/commerce-app.tsx components/finance-views.tsx app/globals.css
git commit -m "feat: replace reconciliation with focused pending actions"
```

---

### Task 8: Retirar o fluxo antigo da interface

**Files:**
- Modify: `components/commerce-app.tsx`
- Delete: `components/reconciliation-view.tsx`
- Delete: `components/product-logistics-dialog.tsx`
- Delete: `components/cost-importer.tsx`
- Delete: `components/costs-view.tsx`
- Modify: `app/globals.css`
- Modify: `README.md`
- Modify: `lib/demo.ts`
- Keep for audit: `app/api/imports/**`, `app/api/reconciliation/route.ts`, `lib/imports.ts`, `lib/workbook.ts`, `lib/reconciliation.ts`, tabelas legadas e documentos R2

**Interfaces:**
- Consumes: telas e projeção novas.
- Produces: aplicação sem Conciliação, Custos e impostos nem Importar custos na navegação; legado disponível só para migração/auditoria.

- [ ] **Step 1: Remover o fluxo visível antigo**

Retirar botão, modais, imports e views de `commerce-app.tsx`. Apagar componentes somente depois de `rg` confirmar ausência de consumidores.

- [ ] **Step 2: Limpar CSS e tipos demo**

Remover seletores exclusivos das telas apagadas. `Workspace` mantém legado somente no servidor de migração, não na UI.

- [ ] **Step 3: Atualizar README**

Documentar conectar conta, cadastrar ficha, acompanhar vendas, resolver Pendências, fechar Full e criar nova vigência quando custo mudar. Declarar que planilha nova não é necessária e arquivos antigos ficam arquivados.

- [ ] **Step 4: Verificar linguagem legada**

Run: `rg -n "Conciliar|Conciliação|Vínculo com a planilha|Importar custos" components app README.md`

Expected: nenhuma ocorrência visível; nomes internos de rotas legadas podem permanecer fora da UI.

- [ ] **Step 5: Executar TypeScript e build**

Run: `npx tsc --noEmit && npm run build`

Expected: PASS.

- [ ] **Step 6: Commitar transição**

```bash
git add -A components app/globals.css README.md lib/demo.ts
git commit -m "refactor: remove daily reconciliation workflow"
```

---

### Task 9: Verificar, revisar, migrar e publicar

**Files:**
- Modify only as verified failures require: files owned by Tasks 1–8
- Track: `.superpowers/sdd/2026-09-21-fichas-de-anuncios-e-pendencias/progress.md`

**Interfaces:**
- Consumes: incremento completo e migração 0008.
- Produces: versão privada publicada, rollout ativo e smoke test autenticado.

- [ ] **Step 1: Executar suíte completa**

Run: `npm test`

Run: `npx tsc --noEmit`

Run: `npm run build`

Expected: todos passam.

- [ ] **Step 2: Recriar banco local e executar APIs/Workers**

Mover `.wrangler/state` para backup em `/tmp`, aplicar `drizzle/0000` a `0008` e fixture de outro proprietário, iniciar servidor e executar:

```bash
npm run test:api:local
npm run test:worker:local
node --test tests/meli-events-worker.local.mjs
```

Expected: PASS.

- [ ] **Step 3: Fazer QA desktop e celular**

Migrar fixture, editar ficha, testar vigência, copiar SKU 64265, validar impostos, fallback/override, Full, igualdade entre telas, contador de Pendências, console/rede e 390×844.

- [ ] **Step 4: Solicitar revisão independente**

Usar `superpowers:requesting-code-review` desde `5f9cd7f`. Resolver high/medium confirmados com `superpowers:receiving-code-review` e repetir testes afetados.

- [ ] **Step 5: Verificar imediatamente antes de publicar**

```bash
npm test
npx tsc --noEmit
npm run build
git diff --check
git status --short
```

Expected: verde e árvore limpa depois do commit final.

- [ ] **Step 6: Publicar com Sites**

Usar `sites:sites-hosting`, preservar projeto `appgprj_6aa7f4e301a48191af4c4c0bfd71c094` e acesso privado. Enviar HEAD exato e aguardar deployment `succeeded`.

- [ ] **Step 7: Verificar migração e ativar rollout**

Confirmar tabelas de fichas, correções, catálogo e rollout. Em sessão autenticada, ativar somente se `blockingDifferences===0`. Se houver bloqueios, manter projeção antiga, corrigir e republicar; nunca forçar o corte.

- [ ] **Step 8: Fazer smoke test de produção**

Verificar login, anúncios, ficha migrada, Pendências, origens no detalhe, painel e prévia Full sem criar fechamento fictício. Confirmar ausência de Conciliação, Custos e Importar.

- [ ] **Step 9: Registrar conclusão**

Registrar versão, commit, testes, contagem de fichas migradas, issues e rollout no ledger, sem IDs privados, tokens ou valores comerciais.
