# Serviço de avisos Mercado Livre

Worker complementar do Site privado Central de Vendas. A fila confirma o recebimento após persistência; o consumidor assina chamadas ao Site e o cron recupera alterações a cada minuto. O Site mantém tokens Mercado Livre e dados financeiros. Este Worker recebe somente identificadores de notificações e credenciais técnicas da ponte.

Configuração de produção via Wrangler, na conta Cloudflare autorizada pelo proprietário:

- Filas `central-vendas-meli-events` e `central-vendas-meli-failures`, retenção 24 horas.
- Secrets `BRIDGE_SECRET` (igual a `MELI_AUTOMATION_SECRET` no Site), `SITE_BEARER` (credencial técnica do Site existente), `WEBHOOK_TOKEN` (componente aleatório da URL) e `MELI_APPLICATION_ID`.
- Enviar `SITE_BEARER` no cabeçalho `OAI-Sites-Authorization`. O cabeçalho HTTP `Authorization` não autentica a entrada privada do Sites. A assinatura HMAC continua sendo obrigatória na rota interna.
- URL no portal Mercado Livre: `https://<worker>/notifications/<WEBHOOK_TOKEN>`, tópicos `orders_v2` e `shipments`.
- Não alterar a audiência do Site, a chave `MELI_ENCRYPTION_KEY`, nem registrar tokens em Git/logs.

O endpoint `/health` informa apenas se as configurações existem. Isso não prova recebimento de eventos. Confirmar no Site o contato do agendamento, andamento dos trabalhos e primeiro aviso real antes de concluir a ativação. Falhas da ponte recebem novas tentativas e depois seguem à fila de falhas; após reparar a causa, reprocessar as mensagens antes da expiração da retenção. A busca incremental recupera alterações de vendas mesmo se um aviso for perdido.

Verificação de produção em 16/09/2026: recuperação automática confirmada sem aba do painel aberta, com contatos sucessivos e lote incremental concluído às 23:39:42 UTC (5/5 registros da janela). O formulário da aplicação Mercado Livre foi preparado com `orders_v2` e `shipments`, mas ainda depende de salvar o aceite e CAPTCHA no portal. Nenhum aviso real foi confirmado até essa verificação. A validação visual do painel depende de renovar o login do usuário.

Validação local: `npm test`, `npm run test:api:local`, `node --test tests/meli-worker.local.mjs tests/meli-events-worker.local.mjs`, `npx tsc --noEmit` e build do Site.

A operação começa sem contratação de plano pago. Acompanhar o consumo da conta; limites do plano podem suspender o processamento. A interface sinaliza ausência de contato e mantém a atualização manual disponível.
