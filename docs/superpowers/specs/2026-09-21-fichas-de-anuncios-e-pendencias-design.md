# Fichas de anúncios e pendências automáticas

Data: 21/09/2026

## Objetivo e decisões confirmadas

Reformular o cálculo financeiro para que a operação diária não dependa de conciliar vendas. O sistema deve obter do Mercado Livre tudo o que a API fornecer, guardar custo e imposto diretamente na ficha de cada anúncio e pedir intervenção somente quando uma informação necessária estiver ausente, conflitante ou comprovadamente incorreta.

O desenho foi aprovado com estas decisões:

- cada conta, anúncio e variação possui uma ficha financeira independente;
- custo de compra e imposto são informados na ficha, sem depender de novas planilhas;
- o imposto pode estar incluído no custo, ser um valor adicional por unidade ou um percentual adicional;
- receita, comissão, frete, descontos, status e logística vêm prioritariamente do Mercado Livre;
- uma alteração na ficha cria uma nova vigência e não muda silenciosamente vendas anteriores;
- a tela Conciliação será substituída por Pendências;
- a configuração e o histórico atuais serão reaproveitados na migração;
- a despesa mensal Full continuará sendo informada como total e rateada pelas unidades Full;
- a aplicação continuará atualizando vendas em segundo plano e suportando várias contas;
- nenhum valor financeiro desconhecido será tratado como zero.

O sucesso deste redesenho significa que o usuário configura cada anúncio uma vez, acompanha as vendas automaticamente e só abre Pendências diante de uma exceção real. Um cliente novo deve entender o fluxo sem treinamento sobre conciliação.

## Situação atual

Hoje a aplicação combina uma planilha de custos, vínculos entre anúncio e SKU, ajustes completos por venda e fechamentos mensais Full. O modelo preserva histórico e evita cálculos falsos, mas expõe muitos conceitos ao usuário: custo importado, vínculo, composição manual, revisão, conciliação e fechamento. Uma venda incompleta abre um formulário com todos os componentes financeiros, mesmo quando apenas um campo precisa de correção.

O novo modelo preservará as garantias de auditoria e cálculo, mas mudará a unidade principal de configuração. O anúncio e sua variação serão a fonte persistente de custo e imposto. Ajustes por venda serão exceções pontuais, nunca o caminho normal.

## Alternativas consideradas

### Ficha independente por anúncio — escolhida

Cada anúncio e variação possui custo, imposto, modalidade esperada e vigência próprios. É a opção mais direta de explicar e permite que duas ofertas do mesmo produto tenham operações distintas. Quando valores forem iguais, a interface permitirá copiar uma ficha existente.

### Cadastro central de produtos com anúncios vinculados

Reduz repetição quando muitas ofertas compartilham o mesmo custo, mas reintroduz produto principal, vínculo, herança e exceção. Esses conceitos foram justamente parte da dificuldade do fluxo atual. Poderá ser adicionado futuramente como uma automação opcional, sem mudar a ficha do anúncio como fonte efetiva.

### Composição financeira por venda

É flexível, porém obriga o usuário a entender e confirmar cada componente repetidamente. Equivale ao fluxo de conciliação que será removido da operação normal.

## Modelo mental e navegação

A aplicação terá seis áreas:

1. **Visão geral:** faturamento, contribuição, margem, cobertura e alertas.
2. **Vendas:** lista e composição financeira de cada venda.
3. **Anúncios:** fichas de custo, imposto e operação por anúncio e variação.
4. **Despesas Full:** estimativa e fechamento mensal do total Full.
5. **Pendências:** somente problemas que impedem um resultado confiável.
6. **Contas:** conexões e sincronização com o Mercado Livre.

Conciliação e Custos e impostos sairão da navegação. A importação de planilha deixará de ser uma ação permanente. Arquivos e registros antigos continuarão guardados para auditoria e migração, mas não serão a fonte das vendas novas após a transição.

## Ficha financeira do anúncio

A chave da ficha é proprietário, conta, `itemId` e `variationId`. Uma oferta sem variação usa uma variação nula explícita. Dados nunca atravessam contas, mesmo quando o SKU ou o identificador textual coincide.

Cada revisão da ficha guarda:

- custo de compra unitário com precisão de até quatro casas decimais;
- modo do imposto: `incluído no custo`, `valor por unidade` ou `percentual`;
- valor do imposto quando o modo exigir;
- operação esperada: `detectar automaticamente`, `Full` ou `comum`;
- início da vigência em data comercial de `America/Sao_Paulo`;
- revisão, chave de idempotência, motivo, origem da migração e data de criação.

No modo incluído, nenhum imposto adicional é descontado. No modo unitário, o valor é multiplicado pela quantidade de custo consumida. No modo percentual, a alíquota incide sobre a receita líquida dos itens da linha. Zero é um valor declarado; campo vazio significa desconhecido.

Revisões são imutáveis. Salvar uma mudança cria uma nova vigência. Por padrão, a interface sugere a data atual para afetar apenas vendas posteriores. O usuário pode escolher uma data anterior com um aviso de que vendas desde essa data serão recalculadas. Duas revisões concorrentes retornam conflito e exigem recarga.

A lista de Anúncios agrupa variações sob a oferta e mostra conta, título, identificadores, operação efetiva, custo, imposto, início da vigência, última atualização e estado da configuração. A ficha oferece:

- editar custo e imposto;
- deixar logística automática ou definir Full/comum como apoio;
- copiar custo e imposto de outro anúncio da mesma conta;
- ver a prévia da margem com a última venda;
- consultar o histórico de revisões.

O catálogo de anúncios ativos será sincronizado pela API do Mercado Livre, inclusive antes da primeira venda, para permitir configuração antecipada. Anúncios encontrados somente no histórico de pedidos continuam disponíveis e recebem o estado correspondente.

## Fontes e precedência financeira

Cada componente mantém seu valor e sua origem. A projeção usa as fontes nesta ordem lógica:

1. **Mercado Livre:** receita, comissão, frete do vendedor, descontos, outras despesas disponíveis, status, quantidade e modalidade logística.
2. **Ficha do anúncio:** custo de compra, imposto e apoio de classificação Full/comum.
3. **Fechamento Full:** parcela estimada ou fechada da despesa mensal.
4. **Correção individual:** somente para um campo ausente ou para um valor oficial contestado naquela venda.

A modalidade logística oficial prevalece sobre a ficha. A opção Full/comum da ficha só atua quando a API ainda não foi conclusiva. Uma divergência fica visível como aviso; ela não reclassifica o pedido silenciosamente.

Uma correção de campo ausente é temporária: se o Mercado Livre fornecer depois um valor oficial, esse valor passa a valer e a correção fica registrada como substituída. Se o usuário corrigir um valor oficial que considera incorreto, a correção é um override explícito, exige motivo e guarda a assinatura da fonte. Uma mudança posterior no valor oficial marca o override como Revisar em vez de descartá-lo silenciosamente.

O detalhe da venda exibe uma indicação discreta de origem em cada linha: Mercado Livre, ficha do anúncio, estimativa Full, fechamento Full ou correção manual. A mesma projeção alimenta Visão geral, Vendas e Anúncios para impedir números divergentes entre telas.

## Cálculo e estados do resultado

Para uma venda paga ou reembolsada que ainda consuma custo, a contribuição é:

`receita − comissão − frete − outras despesas − custo consumido − imposto adicional − despesa Full`

O custo consumido usa o custo unitário da revisão vigente multiplicado pela quantidade efetivamente consumida. Reembolso e recuperação de estoque continuam explícitos; o sistema não presume que o produto voltou ao estoque.

Os estados financeiros serão:

- **Automática:** venda comum completa com dados oficiais e ficha válida;
- **Provisória:** venda Full completa cuja despesa mensal ainda é estimada;
- **Fechada:** venda Full coberta por fechamento mensal válido;
- **Pendente:** falta ao menos um valor essencial;
- **Corrigida:** existe uma correção individual válida;
- **Revisar:** uma fonte mudou depois de um override ou fechamento.

Faturamento conhecido continua aparecendo quando a contribuição está pendente. Contribuição, margem e agregações de lucro incluem apenas vendas financeiramente completas. A interface mostra a cobertura do faturamento calculado para que uma margem parcial nunca pareça representar toda a operação.

## Pendências

Pendências substitui a conciliação e mostra somente ações necessárias. Cada item informa o problema em linguagem direta e abre o campo exato a resolver. As categorias iniciais são:

- anúncio sem ficha financeira;
- custo ausente para a data da venda;
- imposto não definido;
- receita, comissão, frete, desconto ou quantidade ausente na API;
- operação Full/comum ainda desconhecida;
- primeiro mês Full sem referência de estimativa;
- fechamento Full ou correção individual que precisa de revisão;
- conflito encontrado durante a migração.

Configurar uma ficha resolve todas as pendências futuras e históricas alcançadas pela vigência. Um campo ausente da API pode ser corrigido apenas naquela venda. Não haverá formulário genérico pedindo toda a composição financeira quando só um valor está faltando.

A tela oferece filtros por conta, tipo e período, um contador na navegação e ações em lote apenas quando elas são seguras, como copiar a mesma ficha para variações selecionadas. Valores financeiros diferentes nunca serão preenchidos em lote por inferência de título ou preço.

## Despesas Full

O fechamento mensal existente será preservado e movido para a área Despesas Full. A experiência terá uma ação principal: escolher conta e mês, colar o total do demonstrativo e conferir a prévia antes de fechar.

Durante o mês aberto, vendas Full usam a média por unidade do último fechamento válido da mesma conta. Sem mês anterior, a despesa permanece desconhecida e as vendas aparecem em Pendências; zero não é usado como estimativa.

No fechamento, somente vendas classificadas como Full, elegíveis e pertencentes à conta e ao mês entram no rateio. O total é distribuído proporcionalmente às unidades, com soma exata até o último centavo. Cancelamento, devolução, alteração de quantidade ou mudança material de fonte após o fechamento marca o mês como Revisar. Uma nova revisão é sempre explícita e o histórico permanece auditável.

Anúncios comuns do mesmo produto não recebem a despesa Full. O SKU 64265, por exemplo, pode ter fichas separadas para a oferta comum e a oferta Full, com o mesmo custo copiado entre elas.

## Persistência e APIs

Uma nova estrutura append-only de eventos de ficha armazenará as revisões por proprietário, conta, anúncio, variação e vigência. Valores monetários serão persistidos em inteiros com precisão suficiente para manter até quatro casas no custo unitário e serão arredondados para centavos somente depois da multiplicação pela quantidade.

A API de fichas permitirá:

- listar anúncios e a configuração efetiva;
- ler ficha e histórico;
- criar uma revisão com vigência e revisão esperada;
- copiar custo e imposto de outra ficha da mesma conta;
- retirar uma vigência por meio de novo evento, sem apagar histórico.

Correções individuais também serão append-only, idempotentes e separadas por campo. Elas nunca aceitarão uma composição inteira calculada no navegador. O servidor validará conta, venda, fonte atual, revisão esperada, valor, modo da correção e motivo.

O endpoint do workspace passará a retornar vendas projetadas, resumos de anúncios, pendências e fechamentos Full. As rotas antigas de conciliação e importação permanecerão disponíveis apenas durante a migração e depois serão retiradas da interface. Toda leitura e escrita continuará filtrada pelo proprietário autenticado.

## Sincronização automática

Pedidos, envios e descontos continuarão chegando pela ponte de eventos e pela recuperação periódica. O sincronizador de anúncios manterá título, status, variações e atributos mínimos necessários à ficha. Ele não alterará preço, estoque, logística ou conteúdo no Mercado Livre.

Quando a API falhar, a venda é persistida com os dados conhecidos e o trabalho de enriquecimento continua recuperável. A interface recebe a venda rapidamente, marca o campo ausente e atualiza a projeção quando o dado oficial chegar. A correção manual não impede novas tentativas de sincronização.

## Migração dos dados existentes

A migração será aditiva e reversível no nível de leitura: nenhuma planilha, custo, vínculo, ajuste ou fechamento atual será apagado.

Para cada conta, anúncio e variação já conhecidos:

1. converter vínculos por anúncio e vigência em revisões de ficha;
2. localizar o custo da mesma conta e SKU que estava vigente em cada data;
3. copiar custo, tratamento tributário e classificação Full/comum;
4. criar revisões adicionais quando a vigência material do custo ou do vínculo mudar;
5. preservar ajustes por venda como correções históricas identificadas como legado;
6. manter os fechamentos Full e suas parcelas sem alteração.

Quando não existir vínculo, a migração poderá usar o SKU exato trazido pela venda somente se houver uma correspondência única na mesma conta. Ela nunca usará título, preço ou similaridade textual. Ambiguidade, custo ausente ou imposto desconhecido cria uma Pendência de migração.

Antes da troca de leitura, um relatório compara a projeção antiga e a nova por venda. Diferenças não explicadas bloqueiam a ativação. Após a validação, a nova projeção passa a ser a fonte da interface. Os registros antigos permanecem disponíveis para auditoria e para uma reversão operacional durante a implantação.

## Interface de transição

No primeiro acesso após a migração, Anúncios mostra um resumo: fichas reaproveitadas, fichas completas e fichas que precisam de atenção. O usuário revisa somente conflitos ou dados ausentes. Não será exigida confirmação individual das fichas migradas que tiverem fonte única e completa.

As cópias criadas pela migração exibem a origem `Dados anteriores` no histórico. Depois que uma ficha receber a primeira revisão nativa, o fluxo normal segue sem referência à planilha.

## Falhas e recuperação

- Campo financeiro ausente nunca vira zero implícito.
- Falha da API mantém a venda e agenda nova tentativa.
- Escrita concorrente não sobrescreve revisão; retorna conflito.
- Correção temporária é substituída apenas por valor oficial válido.
- Override explícito é marcado para revisão quando sua fonte muda.
- Falha parcial da migração não ativa a nova projeção.
- Uma conta não reutiliza ficha, fechamento ou correção de outra.
- Retirada de revisão cria novo evento; histórico não é apagado.
- A interface recarrega o workspace depois de cada mudança antes de mostrar sucesso.

## Verificação e critérios de aceitação

1. Uma ficha completa permite calcular automaticamente vendas seguintes sem conciliação.
2. Alterar custo ou imposto hoje não muda vendas anteriores; escolher vigência passada recalcula somente o intervalo alcançado.
3. Imposto incluído não é descontado novamente; imposto unitário respeita quantidade; percentual usa a receita líquida dos itens.
4. Receita, comissão, frete, descontos, status e logística conhecidos usam a API do Mercado Livre.
5. Um campo oficial ausente cria uma pendência e bloqueia a margem, sem bloquear o faturamento conhecido.
6. Uma correção temporária deixa de valer quando o valor oficial chega, sem dupla dedução.
7. Um override de dado oficial exige motivo e fica Revisar se a fonte mudar.
8. Anúncios Full e comum do SKU 64265 podem compartilhar custo por cópia, mas somente o Full recebe rateio mensal.
9. O primeiro mês Full sem referência fica pendente; os seguintes usam estimativa da mesma conta.
10. O fechamento mensal preserva o total exato em centavos e alterações posteriores exigem revisão explícita.
11. A migração reaproveita correspondências únicas, preserva histórico e sinaliza ambiguidades sem inventar dados.
12. Visão geral, Vendas e Anúncios mostram a mesma contribuição para a mesma venda.
13. Trocar de conta ou usar identificadores iguais não mistura dados.
14. Sincronização por evento e recuperação periódica atualizam a projeção com o aplicativo fechado.
15. Testes de domínio, migração, API, isolamento, Worker, desktop, celular e acessibilidade passam antes da publicação.

## Fora deste incremento

- Alterar anúncios, preço, estoque ou logística no Mercado Livre.
- Calcular obrigações tributárias ou substituir orientação contábil.
- Integrar diretamente com o Citel ou outro ERP.
- Inferir custo por título, preço ou semelhança de produto.
- Unificar anúncios em um cadastro mestre de produto.
- Distribuir despesas Full por peso, volume, estoque médio ou dias armazenados.
- Vender o sistema para terceiros, criar cobrança ou permissões de equipe.

