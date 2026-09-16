# Plano de implementação da atualização automática

> Para execução: Superpowers, com alterações feitas pela agente proprietária do Site. Revisores independentes só leem código. Aplicar TDD e verificar o runtime Worker.

**Objetivo:** receber novas vendas e alterações sem depender de aba aberta e sem reler o histórico inteiro.

**Arquitetura:** Site privado mantém dados e tokens; Worker complementar recebe eventos em fila e aciona recuperação periódica; serviço no Site processa trabalhos persistentes e atualiza a interface.

**Tecnologias:** TypeScript, D1, Cloudflare Workers/Queues/Cron, HMAC Web Crypto, React; dependências já instaladas.

**Especificação:** ../specs/2026-09-16-atualizacao-automatica-design.md

## Restrições globais

Preservar Site, proprietário, banco, importações, chave de criptografia e contas. Não registrar segredos. Não aplicar custos atuais a vendas anteriores a 15/09/2026. Não publicar o painel nem forjar identidade. Configurar infraestrutura externa somente na conta do usuário. Ativação depende de verificação real, não somente testes.

## Tarefa 1 — consultas incrementais com retomada

Arquivos: `lib/meli/service.ts`, `db/schema.ts`, nova migração aditiva em `drizzle/`, `tests/meli-service.test.ts`.

Interface: `sync(owner, accountId, mode = 'auto')` mantém o contrato de progresso; `auto` usa histórico quando não há marcador e busca por `order.date_last_updated` depois da primeira carga. Retorno inclui `mode: 'history' | 'incremental'`. Cursor só avança após salvar todos os pedidos da janela; execução parcial conserva período/offset. Consultas retomadas usam o modo salvo, não um novo período.

- [ ] Escrever teste que conclui histórico, avança relógio e exige consulta incremental com sobreposição, sem `order.date_created.from`.

```ts
assert.equal(query.has('order.date_created.from'), false);
assert.equal(query.get('order.date_last_updated.from'), '2026-09-15T15:00:00.000Z');
assert.equal(result.mode, 'incremental');
```

- [ ] Executar o teste e registrar a falha antes da alteração.
- [ ] Adicionar modo à execução e cursor à conexão; inicializar cursor de conexões existentes somente a partir de execução concluída da mesma geração.
- [ ] Implementar resolução de janela UTC e preservar cursores em falhas/concorrência.
- [ ] Testar interrupção, retomada, desconexão e não regressão do histórico; executar suíte e commit.

## Tarefa 2 — processamento de um recurso e fila persistente

Arquivos: `lib/meli/service.ts`, `lib/meli/jobs.ts`, `db/schema.ts`, migração aditiva, `tests/meli-jobs.test.ts`.

Interfaces: `enqueueNotification({applicationId,sellerId,topic,resource})`; `processNext(): Promise<{pending:boolean}>`; processamento sempre resolve proprietário/conta no banco, nunca por identidade recebida do cliente. O recurso permitido é `/orders/<id>` ou `/shipments/<id>`. A chave do trabalho incorpora conta e geração. Aquisição de trava por conta é compartilhada por sincronização manual e trabalhos automáticos.

- [ ] Testar evento duplicado produzindo um trabalho, recurso inválido sendo recusado e geração antiga não gravando dados.

```ts
await enqueueNotification(event); await enqueueNotification(event);
assert.equal(await pendingCount(), 1);
await assert.rejects(enqueueNotification({...event, resource:'https://example.test/'}));
```

- [ ] Executar testes em falha.
- [ ] Extrair enriquecimento existente sem alterar regras de dinheiro e criar rotina para pedido/envio individual.
- [ ] Persistir venda pendente antes do enriquecimento; preservar verificação de vendedor, rateio integral e atomicidade de membros do envio.
- [ ] Persistir tentativas, vencimento de trava e próxima tentativa; 401 exige reconectar, 429/5xx preservam trabalho para retomar.
- [ ] Testar falha após gravação inicial, cancelamento fora de ordem, recuperação e trava entre evento/histórico; commit validado.

## Tarefa 3 — ponte autenticada e Worker complementar

Arquivos: `lib/meli/automation-auth.ts`, `app/api/meli/internal/route.ts`, `workers/meli-events/worker.ts`, `workers/meli-events/wrangler.jsonc`, `tests/meli-automation.test.ts`, `tests/meli-events-worker.local.mjs`.

Assinatura canônica: `POST\n/api/meli/internal\n<timestamp>\n<nonce>\n<sha256(body)>`, HMAC SHA-256. Limite de relógio de 180 segundos. Nonce de uso único, registrado antes do processamento. Segredos vazios desativam a rota. Ações permitidas: receber aviso, executar lote, recuperar alterações e ler saúde do serviço; nenhuma ação financeira de escrita no Mercado Livre.

- [ ] Escrever testes de assinatura alterada, replay, expiração, ausência de segredo e rejeição de tamanho excedido.

```ts
assert.equal(await verify(changedBody), false);
assert.equal(await acceptOnce(signedRequest), true);
assert.equal(await acceptOnce(signedRequest), false);
```

- [ ] Implementar assinatura/verificação e teste red-green no runtime real.
- [ ] Worker recebe somente POST com JSON limitado e tópico permitido; confirma depois de `QUEUE.send`, não antes.
- [ ] Consumer chama rota fixa do Site sem redirecionamento, com assinatura nova por tentativa. Erro recuperável retorna trabalho à fila; falhas persistentes seguem para fila de falhas. Agendamento de um minuto aciona recuperação mesmo sem navegador.
- [ ] Configurar somente nomes lógicos no código; secrets e IDs reais ficam na configuração de implantação, sem valores privados no repositório.
- [ ] Validar Worker com saída HTTP interceptada e falhas de fila; commit.

## Tarefa 4 — estado automático e atualização do painel

Arquivos: `components/commerce-app.tsx`, `components/meli-accounts.tsx`, `app/api/meli/status/route.ts`, `lib/meli/service.ts`.

Interface: status de automação inclui configurada, último contato, último evento, trabalhos pendentes e erro seguro. Interface atualiza workspace a cada 15 segundos apenas em modo real e documento visível, sem sobreposição; limpeza cancela futuros disparos ao desmontar. Atualizar vendas manualmente usa consulta incremental depois do histórico.

- [ ] Verificar as transições de estado e ciclo de consultas com relógio controlado.
- [ ] Mostrar configuração pendente enquanto Worker/credenciais não estão ativos; atrasado quando não há contato há mais de três minutos; reconexão somente na conta afetada.
- [ ] Mostrar margem pendente quando faltam dados e manter história de custos intacta.
- [ ] Validar TypeScript, build e comportamento em navegador autorizado.

## Tarefa 5 — ativação e entrega

- [ ] Confirmar conta Cloudflare criada pelo usuário e autenticação segura para implantação.
- [ ] Executar testes, revisão independente somente leitura e build.
- [ ] Publicar alterações do Site existente com migração aditiva e sem alterar audiência.
- [ ] Implantar Worker complementar, fila, fila de falhas, cron e secrets na conta do usuário.
- [ ] Cadastrar URL de notificações e tópicos autorizados da aplicação Mercado Livre.
- [ ] Demonstrar evento recebido, processamento com aba fechada, retomada de falha e atualização visível no painel.
- [ ] Atualizar guia e estado de implantação. Se a infraestrutura não estiver disponível, registrar precisamente o que foi preparado e o que ainda impede a ativação.

## Estado verificado em 16/09/2026

Tarefas 1–3 implementadas: busca incremental com cursor e retomada persistida; fila D1 com deduplicação por revisão, trava por conta e geração; venda provisória seguida de enriquecimento; ponte HMAC com nonce e limites; Worker com filas e recuperação periódica. A tarefa 4 está implementada, com polling visível sem sobreposição e estado separado de último contato e último aviso; validação do painel publicado pendente.

Validações: 88 testes de unidade/serviço, 14 testes da API local, quatro testes no runtime Worker, TypeScript e build concluídos. Revisão independente encontrou e levou à correção de janela com sobreposição, persistência da continuação, reagendamento de aviso novo durante falha antiga e exibição do último evento por proprietário.

Cloudflare autorizada pelo usuário; duas filas criadas. Tarefa 5 em andamento: concluir endereço workers.dev, publicar Site com migrações, configurar segredos da ponte, cadastrar notificações na aplicação existente e verificar processamento real. Nenhuma alteração na audiência ou na chave de criptografia Mercado Livre. Não considerar ativação concluída com base somente nos testes locais.
