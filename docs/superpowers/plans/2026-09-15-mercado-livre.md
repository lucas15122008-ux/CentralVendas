# Integração Mercado Livre — plano

> Execução Superpowers no checkout do Site, com testes antes da implementação. A proprietária do Site faz alterações; agentes auxiliares revisam somente leitura.

**Objetivo:** permitir configurar e autorizar a aplicação existente, sincronizar vendas e usar os custos importados sem alterar o Citel.
**Arquitetura:** OAuth e cliente HTTP exclusivamente no servidor; segredos cifrados no D1; domínio financeiro puro; interface de conexão e sincronização em lotes.
**Tecnologias:** React/Vinext, TypeScript, Web Crypto, Zod, D1 e testes Node. Nenhuma nova dependência necessária.
**Especificação:** ../specs/2026-09-15-mercado-livre.md.

## Restrições

- Somente leitura dos dados Mercado Livre, exceto trocas OAuth de autorização.
- Estado privado por proprietário e conta; BRL, America/Sao_Paulo.
- Preservar migrações já publicadas e arquivos importados.
- Nenhum segredo no cliente, logs ou repositório.
- Valores desconhecidos são nulos, nunca zero presumido.

## 1. Segurança OAuth e domínio de vendas

Arquivos novos: lib/meli/crypto.ts e protocol.ts; tests/meli.test.ts. Alterar lib/finance.ts e tests/finance.test.ts para campos financeiros nulos.

Interfaces: seal(value,key,context), unseal(cipher,key,context), pkceChallenge(verifier), authorizationUrl(config,state,challenge), allocateCents(total,weights), normalizeOrders(accountId,sellerId,orders,shipments).

- [x] Testes antes do código: segredo não aparece em cifra; contexto errado/adulteração falha; PKCE usa SHA256; rateio de 100/3 resulta em soma 100; comissão multiplica quantidade; falta de frete impede margem; vendedor divergente rejeitado; reembolso não vira venda sem perdas.
```ts
assert.deepEqual(allocateCents(100,[1,1,1]),[34,33,33]);
assert.equal(calculateSale({...sale,shippingCents:null},[cost]).contributionCents,null);
```
- [x] Executar testes, observar falha, implementar e repetir até aprovar.

## 2. Persistência e rotas oficiais

Arquivos: db/schema.ts, drizzle/ (nova migração), lib/meli/server.ts e service.ts, app/api/meli/{settings,status,connect,callback,sync,disconnect}/route.ts, app/api/workspace/route.ts.

- [x] Gerar migração apenas com tabelas novas e índices; inspecionar SQL.
- [x] Implementar configuração cifrada; status sem segredos; state consumido atomicamente por dono, conta, cookie, prazo e revisão de configuração.
- [x] Implementar troca de código e renovação com trava e versão; recusas de escopo/identidade devolvem mensagens seguras.
- [x] Implementar lote paginado, vinculação de frete, upsert atômico de pedidos e progresso persistente. Perda de resposta deve permitir repetição do mesmo lote sem duplicação.
- [x] Verificar API com fixtures e regressão de importação em banco local; nunca semear produção.

## 3. Interface de ativação e dados reais

Arquivos: components/meli-accounts.tsx, components/commerce-app.tsx, components/finance-views.tsx, app/globals.css, lib/demo.ts.

- [x] Acrescentar formulário de configuração com callback copiável, campo de segredo sem preenchimento posterior e orientação de permissões.
- [x] Associar vendedor a contas existentes; informar estado, última atualização, retomada, reconexão e desconexão confirmada.
- [x] Acionar próximo lote enquanto a página permanecer aberta; parar em erro e permitir retomada explícita.
- [x] Substituir textos de integração futura por estados reais e mostrar totais conhecidos/pendências, preservando demonstração.

## 4. Entrega

- [x] Todos os testes, TypeScript, build e revisão de segurança/consistência.
- [ ] Gerar MELI_ENCRYPTION_KEY somente se ausente, guardar como segredo Sites e publicar como privado.
- [ ] Entregar o mesmo endereço e os passos exatos para o usuário informar credenciais e autorizar sua aplicação. Não declarar conta conectada antes da autorização real.
