# Central de Vendas — núcleo financeiro

Data: 14/09/2026. Desenho aprovado em conversa. Ajuste confirmado pelo usuário: custos e imposto pago serão enviados por documento exportado do Citel; conexão com API do Citel está fora do escopo.

## Objetivo

Permitir ao proprietário entender vendas, custos e margem de contribuição dos produtos vendidos no Mercado Livre. Uso interno inicial, com organização dos dados que permita adicionar contas e, futuramente, atender outras empresas.

## Entregas e dependências

1. Núcleo financeiro: área privada, contas, vendas, produtos, importação de custos/impostos e cálculo auditável de margem.
2. Próximo ciclo: publicidade e insights, usando o mesmo núcleo de cálculos.
3. Ciclo seguinte: agente de IA com acesso autorizado às métricas e fontes externas de tendências.

O primeiro incremento utilizável terá importação e histórico persistentes, conferência de impostos, painéis e dados de demonstração explicitamente separados. A conexão real ao Mercado Livre exige cadastro da aplicação e autorização do vendedor. Nenhuma credencial ou conta foi fornecida. A compatibilidade com o relatório específico do Citel depende de uma amostra enviada pelo usuário. Essas dependências não impedem construir o importador configurável.

## Regras gerais

- Interface em português do Brasil; BRL; datas comerciais em America/Sao_Paulo.
- Acesso privado ao proprietário autenticado; toda consulta e alteração filtrada pelo identificador do usuário no servidor. A unidade de organização inicial é o proprietário; equipes e cobrança comercial pertencem a outro ciclo.
- Dados de demonstração são identificados e não representam vendas reais. Importações reais nunca alteram os exemplos ou se misturam a eles.
- Não realizar alterações em anúncios, estoque, pedidos ou publicidade neste núcleo.
- Credenciais de integração nunca são incluídas no código cliente ou repositório.
- Nenhuma API do Citel será usada. A fonte é o documento enviado pelo usuário.

## Importação de custos e imposto

Aceitar CSV e XLSX, até 5 MB e 5.000 linhas por importação. O usuário seleciona a aba e a linha de cabeçalho, associa colunas e verifica uma prévia. Código/SKU e custo unitário são obrigatórios. Descrição e imposto são opcionais; ausência de imposto significa informação pendente, não zero.

SKU é texto: preservar zeros à esquerda e não associar produtos por semelhança de nome. Importação é vinculada a uma conta cadastrada e uma data de vigência. O mesmo produto em contas diferentes pode ter custos distintos. Duplicidades de SKU dentro do mesmo lote devem ser corrigidas antes de aplicar.

Mapeamento explícito do imposto:

- Tipo: valor em reais por unidade ou percentual sobre o valor de venda.
- Tratamento: já incluído no custo (somente informativo), adicional ao custo/à venda, ou composição a conferir.
- Percentual de aquisição sobre uma base desconhecida não será tratado automaticamente como percentual de venda. Deve ser convertido em valor unitário ou classificado como pendente.
- Imposto pago não será interpretado como crédito recuperável sem definição do usuário. Não inferir regras tributárias a partir do nome de uma coluna.
- O usuário confirma a interpretação antes da aplicação. Não pré-selecionar que o imposto é adicional.

Datas, números inválidos, valores negativos, SKU ausente, percentuais acima de 100 e duplicidades geram erros por linha. Coluna ausente é diferente de um zero explicitamente declarado. Fórmulas são lidas pelo valor armazenado; uma fórmula sem resultado deve ser corrigida na planilha.

A aplicação salva os valores normalizados, configuração, data, nome do arquivo, autor, quantidade de linhas e arquivo original em armazenamento privado. Novos lotes não apagam os anteriores. Reenvio idêntico para a mesma conta, vigência e configuração é idempotente. Uma alteração intencional gera nova versão. Retirada de um lote exige confirmação e deixa registro.

## Custos e cálculo

Valores de moeda são calculados em inteiros de centavos. Custos unitários aceitam até quatro casas decimais e são arredondados após multiplicar pela quantidade. Para cada venda, selecionar a versão de custo com vigência igual ou anterior à data da venda; entre versões com mesma vigência, usar a importação mais recente. Não usar custo atual retroativamente sem vigência definida pelo usuário.

Margem de contribuição conhecida = receita dos itens já ajustada pelos descontos do vendedor e reembolsos − comissões − frete suportado pelo vendedor − custo das unidades consumidas − imposto adicional identificado − demais despesas variáveis conhecidas.

Imposto incluído no custo é exibido sem nova dedução. Imposto percentual adicional usa a base de receita líquida da linha. Imposto sem composição confirmada ou custo ausente torna a margem incompleta. Produtos devolvidos têm tratamento explícito de recuperação do estoque/custo; não presumir recuperação automática. Frete compartilhado entre itens é alocado uma única vez. A margem percentual usa a soma das receitas do conjunto calculável, sem média simples de percentuais.

O painel separa receita total, receita com custo conhecido, contribuição conhecida e cobertura dos dados. Não apresenta lucro líquido contábil. Publicidade e despesas fixas terão tratamento próprio; enquanto ausentes, a interface informa que a margem é anterior a Ads e despesas fixas. Cálculos de linhas incompletas ficam indisponíveis, não artificialmente positivos.

## Telas

- Visão geral: filtro de conta/período, receita, vendas, contribuição conhecida, cobertura de custos, evolução e produtos com maior contribuição.
- Vendas: busca, status, conta, produto, valores e detalhe da composição da margem.
- Produtos e margem: SKU, receita, quantidade, custo vigente, imposto e contribuição; destaque para pendências.
- Custos e impostos: importador em etapas, prévia e histórico; baixar modelo e arquivo original; inspecionar registros importados.
- Contas: cadastro de conta de trabalho, vínculo com vendedor quando autorizado, estado da conexão e orientação de configuração quando necessário. Um cadastro manual não representa conexão ao Mercado Livre.

Estados vazios explicam a próxima ação. Falha de armazenamento preserva os valores na tela e permite nova tentativa. Filtros afetam métricas, tabelas e gráficos de forma consistente. Dados sem sincronização não aparecem como zero vendas confirmadas.

## Arquitetura

Aplicação React/TypeScript com Vinext, rotas de servidor compatíveis com Cloudflare Workers, D1 para registros e R2 para documentos. Autenticação privada oferecida por Sites. Separar domínio de cálculo, leitura/mapeamento da planilha, persistência e componentes de interface.

Tabelas do primeiro incremento: accounts, imports e cost_versions. Cada registro pertence ao proprietário. Dados de vendas de demonstração são fixtures isoladas; dados reais dependem do conector Mercado Livre. A conexão real, normalização de pedidos e sincronização têm contrato separado para evitar que a ausência de credenciais seja tratada como funcionamento confirmado.

## Verificação e critérios de aceitação

1. Imposto já incluído no custo não é deduzido novamente.
2. Imposto adicional em reais e percentual é calculado na base definida.
3. Imposto pendente e custo ausente impedem margem completa.
4. Seleção de custo respeita vigência e conta.
5. Quantidades, arredondamento e agregação são verificados por exemplos calculados manualmente.
6. O importador preserva SKU textual, números brasileiros, erros por linha e duplicidades.
7. Uma importação persistida continua disponível após recarregar e respeita propriedade no servidor.
8. O arquivo original é privado e não pode ser obtido por outro usuário.
9. Interface utilizável em desktop e celular; formulários e diálogos acessíveis pelo teclado.
10. Status de integração representa o acesso real: nenhum cadastro manual ou exemplo aparece como conta conectada.

## Fontes consultadas

- [Autorização Mercado Livre](https://developers.mercadolivre.com.br/autenticacao-e-autorizacao)
- [Pedidos](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas)
- [Custos no Citel](https://suporte.citelsoftware.com.br/hc/pt-br/articles/12517617024283-C%C3%A1lculo-do-Pre%C3%A7o-m%C3%A9dio-e-configura%C3%A7%C3%B5es)
- [Product Ads atual](https://developers.mercadolivre.com.br/pt_br/product-ads-para-catalogo-e-user-products-leitura)

A conexão efetiva, dados fiscais do documento e disponibilidade de recursos externos serão verificados com dados autorizados; a existência de documentação não prova acesso à conta do usuário.
