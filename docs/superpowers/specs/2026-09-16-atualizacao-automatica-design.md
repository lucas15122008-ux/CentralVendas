# Atualização automática das vendas

Desenho funcional aprovado pelo usuário em 16/09/2026. O usuário confirmou que os custos da planilha são atuais e não devem ser aplicados retroativamente. A conta Cloudflare ainda precisa ser criada pelo usuário.

## Resultado esperado

Após a carga inicial, vendas novas e alterações passam a chegar automaticamente, inclusive com o navegador fechado. A venda aparece primeiro; informações necessárias para a margem são completadas em seguida. O painel consulta seu próprio servidor a cada 15 segundos enquanto está visível. Esse intervalo não representa garantia de entrega do Mercado Livre: atrasos do provedor, falhas e dados financeiros pendentes ficam explícitos.

A carga histórica já concluída fica preservada. A última execução verificada processou 1.094 de 1.094 pedidos. As atualizações rotineiras usam data da última alteração, com sobreposição de uma hora porque a API de busca trabalha com precisão horária. Uma fila persistente deduplica pedidos e retoma falhas. Não reler 30 dias em cada atualização diária.

## Arquitetura

O Site privado continua responsável por autenticação do usuário, banco D1, arquivos R2, custos, credenciais Mercado Livre e cálculos. Não mudar a audiência do Site nem migrar ou apagar os dados existentes.

Um Worker complementar na conta Cloudflare do usuário recebe notificações de `orders_v2` e `shipments`, confirma após persistir o aviso na fila Cloudflare e entrega os avisos ao Site. Um acionamento periódico a cada minuto pede a recuperação de alterações que não chegaram por aviso. A fila tem novas tentativas e uma fila de falhas para mensagens não concluídas.

A comunicação Worker → Site usa uma credencial de acesso de máquina fornecida pelo Sites e uma assinatura HMAC própria com timestamp e nonce. Rotas internas verificam assinatura, expiração e repetição antes de acessar qualquer conta. Não simular identidade de usuário com cabeçalhos. As rotas de uso humano continuam exigindo login e origem válida. O Worker complementar não recebe Client Secret, access token ou refresh token do Mercado Livre; armazena apenas credenciais técnicas dessa comunicação e identificadores de notificações. Nenhum segredo entra no cliente, Git ou logs.

A URL de notificações aceita somente POST, corpo limitado e tópicos/recursos permitidos. Valores recebidos são avisos não confiáveis: os dados efetivos vêm da API oficial usando a conexão do vendedor correto. Nunca buscar uma URL arbitrária recebida na notificação. Aplicação e vendedor precisam corresponder a uma conexão ativa. A chave da fila inclui proprietário, conta e geração da conexão; desconectar invalida o trabalho pendente.

## Processamento e consistência

1. O aviso identifica o pedido, ou o envio cujos pedidos precisam ser atualizados.
2. O servidor consulta a fonte oficial e grava a venda com estado de conciliação pendente quando necessário. Essa gravação não transforma campos ausentes em zero.
3. O enriquecimento reutiliza a verificação já existente de itens/quantidades do envio, rateio de frete, descontos e cancelamentos.
4. Uma trava por conta impede gravações concorrentes do histórico, recuperação incremental e eventos. A gravação também verifica geração da conexão e posse da trava.
5. Repetições não duplicam pedidos. Falha parcial preserva dados já confirmados e deixa o trabalho pendente para retomar.
6. Recuperação incremental mantém janela fixa e offset durante cada execução. O marcador só avança após salvar a execução. Repetir a sobreposição é intencional; pedidos inalterados podem reutilizar o enriquecimento confirmado, mas um aviso de envio força nova conferência do frete.
7. Limites do provedor são respeitados com lotes pequenos e novas tentativas com atraso. Falha de autorização exige reconectar somente a conta afetada.

## Painel e custos

Exibir modo automático, última atualização e estados aguardando configuração, funcionando, atrasado e reconexão necessária. Atualizar os dados com o painel aberto sem reiniciar uma importação e sem misturar dados de demonstração. Suspender consultas do painel quando oculto, retomar quando visível e não sobrepor chamadas.

A associação permanece exata por conta + SKU + vigência. A planilha ativa da Matriz possui 86 produtos, custo e imposto adicional por unidade vigentes a partir de 15/09/2026. Vendas anteriores aguardam documento histórico. Não usar custo atual como estimativa nem alterar vigência sem autorização. Anúncio sem SKU e informação financeira incompleta continuam visíveis para conferência.

## Ativação

Preparar e testar código antes de ativar. O usuário conclui criação da conta Cloudflare e verificação de e-mail. Configurar Worker/fila/acionamento e segredos por canal seguro; registrar a URL e tópicos no aplicativo Mercado Livre. Verificar recebimento, retomada após falha, processamento com a aba fechada e chegada ao painel antes de indicar automático ativo. Não contratar plano pago nem mudar permissão externa sem autorização. Enquanto faltar infraestrutura, o Site mantém atualização manual funcional e indica configuração pendente.

## Fora deste incremento

Publicidade, agente de IA, trends, precificação, mudanças em anúncios/estoque e conciliação contábil completa. Não ampliar o período histórico nem presumir a parcela do vendedor em descontos desconhecidos.

## Evidência e critérios

Testes de assinatura inválida/expirada/repetida, propriedade, vendedor, geração e desconexão; eventos duplicados e fora de ordem; falha recuperável; cursor sem pular períodos; histórico preservado; venda antes do enriquecimento; atualização do painel sem chamadas sobrepostas. Executar testes existentes, TypeScript, build e testes no runtime Worker. Não declarar tempo real ativo somente porque os testes locais passaram.

Referências: [notificações Mercado Livre](https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes), [busca por alterações](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas), [filas Cloudflare](https://developers.cloudflare.com/queues/), [acionamento periódico](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
