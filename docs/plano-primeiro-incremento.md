# Núcleo financeiro — plano do primeiro incremento

> Para execução: usar o fluxo de desenvolvimento do Superpowers com testes de domínio e verificação de interface. A agente proprietária do Site executa as alterações; revisões independentes são somente leitura, conforme o fluxo Sites.

**Objetivo:** entregar importação persistente de custos/impostos, contas de trabalho e uma interface financeira verificável, com dados de exemplo separados enquanto a conexão Mercado Livre não estiver autorizada.

**Arquitetura:** domínio financeiro puro em TypeScript, servidor privado com D1/R2 e interface React. Nenhum acesso ao Citel: somente documentos.

**Tecnologias:** Vinext/React/TypeScript, componentes shadcn, Recharts, SheetJS CE 0.20.3, D1, R2, testes Node.

**Especificação:** [especificacao-nucleo-financeiro.md](especificacao-nucleo-financeiro.md).

## Restrições globais

- Interface pt-BR; BRL; America/Sao_Paulo.
- Arquivos CSV/XLSX até 5 MB e 5.000 linhas.
- Acesso privado e propriedade verificada no servidor.
- Imposto sem classificação permanece pendente; não deduzir imposto incluído duas vezes.
- Demonstração isolada dos documentos reais.
- Não modificar dados de vendedor no Mercado Livre.

## Tarefa 1 — domínio de custos, impostos e margem

Arquivos: `lib/finance.ts`, `lib/imports.ts`, `tests/finance.test.ts`, `tests/imports.test.ts`.

Interfaces: `CostRecord`, `Sale`, `calculateSale(sale, costs)`, `summarizeSales(sales, costs)`, `parseDecimal(value)`, `normalizeRows(rows, mapping, options)`.

- [x] Escrever testes com `node:test` e `node:assert/strict` para imposto incluído, adicional fixo, percentual, desconhecido, custo ausente e vigência.

```ts
// Valores manuais: receita 200, tarifa 30, frete 10, 2 unidades de custo 50.
assert.equal(calculateSale(sale, [includedCost]).contributionCents, 6000);
assert.equal(calculateSale(sale, [additionalTax5PerUnit]).contributionCents, 5000);
assert.equal(calculateSale(sale, [additionalTax6Percent]).contributionCents, 4800);
assert.equal(calculateSale(sale, []).contributionCents, null);
```

- [x] Executar `node --experimental-strip-types --test tests/*.test.ts`; observar falha pela ausência do comportamento.
- [x] Implementar domínio puro, incluindo seleção de custo por conta/SKU/data e estados incompletos.
- [x] Normalizar moeda brasileira, preservar zeros do SKU e recusar linhas inválidas ou duplicadas.
- [x] Executar os testes; corrigir somente falhas reais.

## Tarefa 2 — armazenamento privado e importação atômica

Arquivos: `db/schema.ts`, `lib/server.ts`, `app/api/workspace/route.ts`, `app/api/accounts/route.ts`, `app/api/imports/route.ts`, `app/api/imports/[id]/route.ts`, `drizzle/`.

Interfaces: GET workspace retorna contas, importações e custos do proprietário. POST accounts cria conta de trabalho não conectada. POST imports recebe arquivo e configuração, valida, persiste R2 e grava metadados/custos no mesmo batch D1. GET import por ID entrega somente documento pertencente ao usuário. DELETE import marca lote retirado.

- [x] Definir tabelas com owner_id e índices por proprietário/conta/SKU/vigência. Gerar e inspecionar migração.
- [x] Exigir identidade no servidor e origem correspondente nas mutações; rejeitar pedidos anônimos com 401 e origem estrangeira com 403.
- [x] Validar dados com Zod, normalizar no servidor e aplicar lote somente quando todas as linhas forem válidas.
- [x] Usar chave de idempotência derivada de arquivo, conta, vigência e mapeamento. Não armazenar segredos em respostas ou logs.
- [x] Verificar persistência, retirada de lote e recusa de IDs de outro proprietário.

## Tarefa 3 — superfície de trabalho

Arquivos: `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `components/commerce-app.tsx`, `components/cost-importer.tsx`, `components/finance-views.tsx`, `lib/demo.ts`, `public/favicon.svg`.

Interfaces: componente principal recebe nome do usuário; busca workspace no servidor; visão demonstração usa exclusivamente fixtures. Importador recebe contas e callback de conclusão; arquivo real é aplicado apenas ao workspace real.

- [x] Criar navegação, filtros globais e painel com receita, contribuição conhecida e cobertura.
- [x] Construir fluxo de arquivo, aba/cabeçalho, mapeamento, imposto/vigência, prévia e confirmação.
- [x] Criar listagens de vendas, produtos, custos e contas; detalhes auditáveis e busca.
- [x] Publicar a primeira prévia local apenas quando o painel, navegação e ao menos um fluxo forem coerentes.
- [x] Verificar importação de um CSV de exemplo, reload, filtros, imposto incluso/adicional e estados vazios.

## Tarefa 4 — entrega e validação

- [x] Executar testes de domínio, TypeScript e build.
- [x] Verificar browser em desktop e celular; resolver clipping e erros de console.
- [x] Revisar isolamento de dados, deduções tributárias e limitações de conexão real.
- [ ] Publicar como Site privado e verificar status terminal de sucesso.
- [ ] Entregar link, especificação e solicitar uma amostra real da planilha para ajustar o mapeamento. Registrar que vendas reais ainda exigem conexão autorizada do Mercado Livre e que publicidade/IA pertencem aos ciclos seguintes.

## Validação em 14/09/2026

35 testes de domínio e leitura de planilha aprovados; 7 cenários de API aprovados (8 testes incluindo o agrupador); TypeScript sem erros; build concluído. Interface conferida em 1440×960 e 390×844, com importação CSV, reload, histórico, retirada, busca e detalhe da venda. Testes utilizam apenas fixtures sintéticas no ambiente local. Nenhuma conta Mercado Livre foi conectada.

Correções adicionais verificadas: precisão numérica de XLSX, percentuais formatados, limite de linhas sem truncamento silencioso, recuperação de commit com resposta perdida, reenvios concorrentes, fuso de São Paulo e agrupamento de produtos separado por conta.
