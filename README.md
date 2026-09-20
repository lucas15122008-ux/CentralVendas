# Central de Vendas

Primeiro incremento do aplicativo privado para gerenciar custos e margem de operações no Mercado Livre.

## Funciona nesta versão

- Contas de trabalho separadas por proprietário autenticado.
- Importação configurável de CSV/XLSX exportados do Citel, com prévia, vigência, custo unitário e imposto.
- Histórico persistente, download privado do original e retirada de lotes sem apagar o histórico.
- Cálculo testado de contribuição conhecida, sem duplicar imposto incluído, com pendências explícitas.
- Conexão oficial com o Mercado Livre, histórico incremental e atualização automática por notificações.
- Conciliação por anúncio, variação, SKU e vigência, com ajustes manuais versionados e despesas do Full separadas.
- Painéis de demonstração, filtros, busca e detalhe da venda; interface em português, BRL e fuso de São Paulo.

## Conciliação mensal do Full

1. Em **Produtos**, abra **Configurar anúncios** e vincule cada anúncio e variação do Mercado Livre ao SKU correspondente do Citel.
2. Deixe a modalidade em **Detectar pelo Mercado Livre** quando o envio oficial estiver disponível. Quando não estiver, classifique aquele anúncio como **Mercado Livre Full** ou **Venda comum**.
3. Durante o mês aberto, acompanhe a margem provisória. O sistema usa a média por unidade do último mês fechado; no primeiro mês sem referência, a margem permanece **A conferir**.
4. Quando o demonstrativo mensal estiver disponível, abra **Conciliação**, escolha a conta e o mês e informe o valor total da despesa Full.
5. Confira as unidades incluídas, as exclusões e os conflitos antes de confirmar. O total é rateado por unidade Full e os centavos são preservados.
6. Se uma devolução ou mudança na origem alterar o mês, o fechamento aparece como **Revisar**. Retire o fechamento, confira os dados e salve uma nova revisão.

Uma nova planilha de custos não é necessária para cada fechamento Full. Reimporte a planilha somente quando custo, imposto ou data de vigência mudar.

## Limites atuais

Publicidade, módulo de insights e agente de IA ainda não foram implementados. Custos atuais não são aplicados retroativamente: vendas antigas precisam de uma base com a vigência correta ou de conciliação individual.

## Desenvolvimento

Requer Node 22.13 ou superior. `npm install`, `npm run dev -- --hostname 127.0.0.1`.

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

`lib/` contém cálculo, datas, leitura e normalização de documentos. `app/api/` contém acesso privado a D1/R2. `components/` contém a interface. `drizzle/` contém somente migrações de esquema para produção. `tests/` contém fixtures e testes; `docs/` registra o escopo.
