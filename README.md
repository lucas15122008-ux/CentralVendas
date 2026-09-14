# Central de Vendas

Primeiro incremento do aplicativo privado para gerenciar custos e margem de operações no Mercado Livre.

## Funciona nesta versão

- Contas de trabalho separadas por proprietário autenticado.
- Importação configurável de CSV/XLSX exportados do Citel, com prévia, vigência, custo unitário e imposto.
- Histórico persistente, download privado do original e retirada de lotes sem apagar o histórico.
- Cálculo testado de contribuição conhecida, sem duplicar imposto incluído, com pendências explícitas.
- Painéis de demonstração, filtros, busca e detalhe da venda; interface em português, BRL e fuso de São Paulo.

## Limites atuais

Não há conexão Mercado Livre, sincronização de vendas, publicidade, módulo de insights ou agente de IA. O cadastro de conta organiza planilhas; ele não conecta um vendedor. Os painéis financeiros usam exclusivamente exemplos identificados. A compatibilidade com a planilha específica do Citel ainda depende de uma amostra autorizada.

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
