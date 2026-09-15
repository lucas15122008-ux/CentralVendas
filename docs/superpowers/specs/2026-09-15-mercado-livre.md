# Mercado Livre: autorização e vendas

Continuação autorizada pelo usuário em 15/09/2026. Ele confirmou que a importação da planilha funciona e que já possui aplicação Mercado Livre. Preservar os custos e documentos existentes.

## Decisão

Usar OAuth oficial no servidor e associar um vendedor à conta de trabalho existente. A alternativa de importar vendas por CSV adiaria a integração desejada. Uma integração ampla com publicidade e IA será construída sobre os dados de vendas reconciliados, em outro incremento.

O login do app continua sendo o ChatGPT/Sites. OAuth Mercado Livre concede acesso aos dados do vendedor; não é um segundo login para a aplicação.

## Configuração e autorização

Configuração por proprietário: Client ID, Client Secret e indicação de PKCE. Armazenar secret e tokens cifrados com AES-GCM usando MELI_ENCRYPTION_KEY, uma chave aleatória de 256 bits guardada como segredo de hospedagem. A API nunca retorna os segredos. Não registrar corpos de respostas OAuth ou dados pessoais do comprador.

Retorno fixo: https://central-vendas-lucas.kisashi.chatgpt.site/api/meli/callback. O usuário deve cadastrar exatamente esse endereço no portal. State aleatório de uso único, validade de dez minutos, vinculado ao proprietário, conta, configuração e navegador (cookie por tentativa, HttpOnly SameSite=Lax, isolando duas abas). PKCE S256 quando habilitado. Validar vendedor Brasil, identidade do token e associação exclusiva. Uma conta já vinculada não pode mudar de vendedor, protegendo seu histórico; reconexão deve usar o mesmo vendedor.

Cada início de conexão ou desconexão troca a geração da conexão e invalida respostas OAuth, refresh e sincronizações anteriores. Rotação de refresh token registra a tentativa antes da chamada. Tentativa em voo abandonada nunca reutiliza o token; a recuperação exige reconexão. Falha definitiva pede reconexão; timeout não repete token de uso único automaticamente. Alterações de configuração bloqueadas enquanto houver conexão ativa; desconectar remove tokens locais e preserva histórico. Revogação no portal é orientada, sem mutação remota neste incremento.

## Sincronização

Atualização manual dos últimos 30 dias, paginada em solicitações pequenas, com progresso persistido e retomada. Cada sincronização fixa a janela inicial e os filtros; refaz a janela para captar mudanças de pedidos recentes. Nenhum cron ou webhook público é criado. Interface comunica que atualizar exige ação do usuário e permanecer na página; pode retomar após fechamento.

Trazer pedidos por vendedor autorizado, com paginação oficial e identificadores tratados como texto. Nunca calcular tarifas por porcentagens fixas: usar sale_fee por unidade. Consultar custos reais de envio (senders[].cost), itens do envio e todos os pedidos associados antes de ratear o frete uma única vez. Dividir centavos proporcionalmente à receita dos itens, preservando a soma exata. Se a composição do envio não puder ser confirmada, manter frete e margem pendentes.

Custos associados exclusivamente por SKU exato e conta; faltas ou conflitos permanecem pendentes. Guardar identificação de anúncio/variação para rastreabilidade, sem adivinhar por nome. Reembolsos, descontos/promos sem conciliação e valores ausentes tornam o cálculo incompleto. Não transformar ausência de tarifa/frete/receita em zero. Valores de receita incertos ficam fora do total conhecido, com contagem explícita. Consultar também /orders/{id}/discounts; promoções, cupons e cashback encontrados ou não confirmados ficam pendentes. Conferir pedido, anúncio, variação e quantidade em todos os itens do envio. Todos os pedidos de um mesmo frete são gravados em uma única transação, inclusive os recuperados fora da página. Uma trava por conta e condições de geração/execução impedem lotes atrasados de sobrescrever dados. Novas linhas substituem atomicamente a versão daquele pedido; reenvio não duplica vendas.

## Contratos e armazenamento

Novas tabelas: meli_apps, meli_connections, meli_oauth_states, meli_sync_runs e meli_orders. Todas filtradas por owner_id; contas continuam com o mesmo ID. Dados normalizados dos pedidos são suficientes: não persistir nome, endereço, documento, telefone ou e-mail do comprador.

GET /api/meli/status: configuração pública, conexões e progresso. POST /api/meli/settings: cadastrar configuração cifrada. POST /api/meli/connect: iniciar autorização. GET /api/meli/callback: concluir OAuth, redirecionando para resultado neutro. POST /api/meli/sync: iniciar ou processar próximo lote. POST /api/meli/disconnect: descartar acesso local. Mutações exigem identidade e origem exata.

GET /api/workspace passa a entregar vendas reais normalizadas e estados das conexões. Demonstração permanece isolada. Painéis exibem cobertura e valores conhecidos; não sugerem sincronização automática. Publicidade, despesas fixas e conciliação avançada de devoluções permanecem fora da contribuição completa atual.

## Verificação

Testar cifra/adulteração/contexto, state/PKCE, renovação, vendedor divergente, rateio de frete, SKU, comissão por unidade, cancelamentos/reembolsos e valores ausentes. Testar o serviço com SQLite em memória e respostas HTTP do Mercado Livre simuladas apenas nos testes. Testar rotas locais reais com identidade de desenvolvimento e credenciais fictícias, sem chamar o provedor. Verificar migração aditiva e regressão das importações. Publicar privadamente; ativação real depende do usuário cadastrar as credenciais e autorizar o vendedor.

## Fontes oficiais

- https://developers.mercadolivre.com.br/autenticacao-e-autorizacao
- https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas
- https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-envios
