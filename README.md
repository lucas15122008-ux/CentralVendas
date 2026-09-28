# Central de Vendas

Aplicativo privado para acompanhar vendas, custos, impostos e margem de operações no Mercado Livre.

## Funciona nesta versão

- Contas de trabalho separadas por proprietário autenticado.
- Ficha financeira por anúncio e variação, com custo, imposto, modalidade logística, vigência e histórico de revisões.
- Cálculo testado de contribuição conhecida, sem duplicar imposto incluído e sem transformar dados ausentes em zero.
- Conexão oficial com o Mercado Livre, histórico incremental e atualização automática por notificações.
- Pendências pontuais para dados ausentes ou alterados, com correções versionadas por campo.
- Despesas mensais do Full separadas, com prévia, exclusões, rateio exato dos centavos e histórico.
- Origem de cada valor no detalhe da venda: Mercado Livre, ficha do anúncio, estimativa ou fechamento Full e correção.
- Painéis de demonstração, filtros e busca; interface em português, BRL e fuso de São Paulo.

## Fluxo de trabalho

1. Em **Minhas contas**, conecte cada vendedor e execute a primeira atualização. Depois disso, anúncios e vendas continuam sendo atualizados automaticamente, inclusive com o painel fechado.
2. Em **Anúncios**, complete as fichas indicadas. Informe custo unitário, tratamento do imposto e a data a partir da qual esses valores são válidos. Deixe a operação automática sempre que a API confirmar a logística.
3. Quando custo ou imposto mudar, edite a ficha e crie uma nova vigência. As vendas anteriores continuam usando a revisão que valia na data da venda.
4. Em **Vendas**, abra um pedido para conferir o resultado e a origem de cada valor.
5. Em **Pendências**, resolva somente as exceções. Um campo ausente pode receber um valor temporário; a substituição de um valor oficial fica identificada e volta para revisão se a API mudar.
6. Em **Despesas Full**, selecione a conta e o mês, informe o total do demonstrativo, confira unidades e exclusões e salve. O sistema rateia o valor pelas unidades elegíveis e preserva todos os centavos.
7. Se vendas, devoluções ou custos mudarem depois de um fechamento, o mês aparece como **Revisar**. Retire o fechamento e salve uma nova revisão após conferir a prévia.

Não é necessário enviar uma nova planilha para continuar calculando vendas. As planilhas e correções antigas foram reaproveitadas na migração inicial; os arquivos originais e eventos anteriores permanecem arquivados para auditoria, fora do fluxo diário.

## Limites atuais

Módulo de insights e agente de IA ainda não foram implementados. A contribuição de cada venda é anterior a publicidade e despesas fixas; a tela Publicidade lê o gasto diário do Mercado Ads por anúncio (últimos 30 dias, com os dois dias mais recentes relidos a cada hora) e mostra a contribuição do anúncio e do período depois dos Ads. A leitura exige a permissão de Publicidade na aplicação do Mercado Livre. Uma ficha com vigência atual não altera vendas antigas; para corrigir o histórico, crie a vigência correspondente ou resolva o campo indicado em Pendências.

## Desenvolvimento

Requer Node 22.13 ou superior. `npm install`, `npm run dev -- --host 0.0.0.0`.

O ambiente local usa somente a identidade fictícia Seedy pelo fluxo `/signin-with-chatgpt`. O middleware de login fictício existe apenas no servidor de desenvolvimento e rejeita cabeçalhos de identidade forjados. Produção depende da autenticação privada do Sites.

Depois do primeiro build, inicialize o banco local vazio uma única vez:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_foamy_firestar.sql
```

## Verificação

```sh
npm test
npx tsc --noEmit
npm run build
```

Para a integração local, mantenha o servidor em `127.0.0.1:5173`, aplique a fixture sintética de outro proprietário e execute:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file tests/fixtures/foreign-owner.sql
npm run test:api:local
```

Esses testes criam contas e lotes sintéticos exclusivamente no banco local. Nunca aplique as fixtures em produção. Verificam autenticação, origem, propriedade, precisão, atomicidade, concorrência, idempotência, download e retirada com recuperação de versão anterior.

## Estrutura

`lib/` contém cálculo, projeção, datas, migração e integrações. `app/api/` contém acesso privado a D1/R2. `components/` contém a interface. `drizzle/` contém somente migrações de esquema para produção. `tests/` contém fixtures e testes; `docs/` registra o escopo e as decisões.



By: Lucas Leite