# Fechamento mensal das despesas Full

Data: 19/09/2026

## Objetivo e decisões confirmadas

Automatizar a classificação e a conciliação das vendas do Mercado Envios Full sem inventar uma despesa por pedido que o demonstrativo do Mercado Livre não fornece. O proprietário quer acompanhar a margem ao longo do mês e, quando receber o demonstrativo mensal com apenas o valor total, fechar a despesa e distribuí-la pelas unidades Full vendidas.

O desenho foi aprovado com estas decisões:

- o demonstrativo mensal contém somente o total da despesa Full;
- a maioria dos produtos Full tem porte e peso semelhantes;
- o rateio final será por unidade vendida;
- um SKU pode ser vendido em ofertas Full e comuns, como o SKU 64265;
- custo e imposto continuam vindo da planilha do Citel e respeitam a vigência já cadastrada;
- preço de venda não determina custo nem modalidade logística;
- cancelamentos e devoluções não entram silenciosamente em um fechamento já concluído;
- a aplicação deve continuar útil em tempo real, antes do demonstrativo mensal.

## Situação atual

A conciliação existente mantém os pedidos originais e a planilha intactos. Um vínculo por conta, anúncio, variação e vigência escolhe o SKU de custo. Um ajuste manual pertence a uma única venda e registra receita, tarifa, frete, outras despesas, custo, imposto e despesa Full. Visão Geral, Vendas e Produtos recebem a mesma projeção conciliada.

Hoje a modalidade Full só existe dentro do ajuste manual da venda. O pedido normalizado não preserva o tipo logístico do envio, e o vínculo do anúncio não guarda a modalidade esperada. Por isso uma confirmação Full não alcança vendas futuras. Também não existe fechamento mensal, estimativa provisória nem rateio.

O relato de que conciliações completas foram salvas sem alterar a interface será tratado como defeito do fluxo existente. Antes de considerar a nova função concluída, a implementação verificará persistência, recarga do workspace, filtros de período e agregação financeira com um teste integrado que reproduza salvar e voltar a consultar os indicadores.

## Alternativas consideradas

### Rateio por unidade — escolhido

Cada unidade Full elegível recebe a mesma parcela da despesa mensal. É a melhor aproximação disponível porque o demonstrativo só traz o total e os produtos têm porte semelhante. O algoritmo preserva todos os centavos e usa uma ordem estável para distribuir resíduos de arredondamento.

### Rateio por faturamento

Aplicaria a mesma porcentagem de despesa a todos os produtos Full. Isso faria um produto mais caro absorver mais custo mesmo com trabalho logístico semelhante, distorcendo a análise desejada.

### Fatores diferentes por produto

Permitiria pesos gerenciais por tamanho ou complexidade. Exigiria cadastro e manutenção sem uma fonte confiável do demonstrativo. Fica fora deste incremento e pode ser adicionado se a operação passar a incluir portes muito diferentes.

## Identificação da modalidade Full

A modalidade pertence à venda e à oferta logística, não ao SKU interno. A classificação usa esta precedência:

1. tipo logístico do envio retornado pelo Mercado Livre;
2. classificação manual da venda;
3. configuração explícita do anúncio e variação, com vigência;
4. pendente quando nenhuma fonte é conclusiva.

O sincronizador consultará os detalhes do envio e normalizará o tipo logístico. `fulfillment` representa Full. A configuração feita em Produtos funciona como apoio para vendas cujo detalhe logístico ainda não chegou. Quando o dado oficial chegar, ele prevalece. Uma divergência entre o dado oficial e a configuração gera aviso, em vez de reclassificar silenciosamente o histórico.

O vínculo de produto passa a guardar, de forma independente, o SKU de custo e a modalidade esperada. Assim, o SKU 64265 pode usar o mesmo custo em dois anúncios, enquanto apenas o anúncio Full participa do rateio. Conta, anúncio, variação e data de vigência continuam isolando a regra.

A documentação oficial atual identifica `fulfillment` como tipo do Mercado Envios Full e alerta que um mesmo produto pode conviver com mais de uma logística. Portanto, a configuração do anúncio não será usada para sobrescrever um tipo diferente confirmado no envio.

## Fechamento mensal

O fechamento pertence a uma conta e a um mês comercial em `America/Sao_Paulo`. O proprietário informa:

- mês de competência;
- valor total da despesa Full em BRL;
- motivo ou observação para auditoria.

São elegíveis apenas linhas de venda classificadas como Full, com data dentro do mês, status pago e quantidade consumida conhecida e positiva. Vendas pendentes, canceladas e reembolsadas não recebem rateio até terem tratamento confirmado. A tela apresenta a lista e a quantidade total antes da confirmação.

O rateio usa a quantidade consumida da linha. Para uma despesa `T` e quantidades `qᵢ`, cada linha recebe uma parcela proporcional a `qᵢ / Σq`, em centavos inteiros. O algoritmo de maior resto, com desempate estável pelo identificador da venda, garante que a soma das parcelas seja exatamente `T`.

Exemplo: R$ 10.000,00 para 200 unidades resulta em R$ 50,00 por unidade. Uma linha com duas unidades recebe R$ 100,00. Se houver centavos indivisíveis, eles são distribuídos uma única vez entre as primeiras linhas na ordem estável.

Ao fechar, o sistema registra uma revisão imutável contendo o total, a quantidade, o retrato das vendas elegíveis e as parcelas por venda. O valor rateado passa a compor `fullExpenseCents` sem apagar um ajuste manual anterior. O campo manual de despesa Full deixa de ser a fonte normal para meses fechados; se existir conflito, a tela exige que o usuário escolha retirar o valor manual ou excluir a venda daquele fechamento, impedindo dupla dedução.

Se uma venda, quantidade, status, modalidade ou custo material mudar depois do fechamento, a revisão fica `Revisar`. Os valores daquele fechamento permanecem visíveis no histórico, mas a contribuição atual das vendas afetadas volta a ficar pendente até uma nova revisão. O proprietário cria a revisão depois de conferir a alteração. Nenhum fechamento é recalculado silenciosamente.

## Resultado provisório em tempo real

Enquanto o mês estiver aberto, cada venda Full usa como estimativa o custo médio por unidade do último fechamento válido da mesma conta:

`estimativa por unidade = total Full fechado / unidades Full fechadas`

A estimativa é multiplicada pela quantidade da venda e identificada como `Despesa Full estimada`. O resultado e a margem ficam com situação `Provisória`. Quando o mês atual é fechado, todas as estimativas daquele mês são substituídas pelas parcelas reais do total informado.

Se a conta ainda não possui um fechamento anterior, a despesa Full permanece desconhecida e a margem da venda fica pendente. O sistema não usa zero como estimativa. Uma conta nunca empresta taxa de outra conta.

Os estados financeiros passam a distinguir:

- `Pendente`: falta custo, imposto, valor da venda ou referência Full;
- `Provisória`: todos os valores estão disponíveis, mas a despesa Full é estimada;
- `Automática`: venda comum calculada pelas fontes vigentes;
- `Fechada`: venda Full coberta por um fechamento mensal válido;
- `Manual`: venda confirmada individualmente;
- `Revisar`: a fonte mudou depois da confirmação ou do fechamento.

Visão Geral e Produtos mostram quando o período inclui resultado provisório. Valores provisórios participam do acompanhamento operacional, mas aparecem separados dos fechados na cobertura dos dados. O detalhe da venda informa origem, mês e taxa unitária da despesa Full.

## Persistência e auditoria

Serão adicionadas estruturas imutáveis para revisões de fechamento e suas parcelas. Cada registro pertence ao proprietário e à conta. Uma chave de idempotência impede duplicidade; a revisão esperada impede que duas abas fechem o mesmo mês ao mesmo tempo.

Uma revisão de fechamento guarda:

- proprietário, conta e mês;
- revisão, ação e chave idempotente;
- total em centavos, unidades elegíveis e estado;
- assinatura das fontes materiais;
- motivo, autor lógico e datas.

Cada parcela guarda fechamento, venda, quantidade e centavos alocados. A soma das parcelas é validada contra o total antes do commit. Cabeçalho e parcelas são gravados na mesma transação D1. A leitura sempre filtra por proprietário e conta.

Os eventos de vínculo de produto continuarão append-only e ganharão modalidade esperada opcional. Eventos antigos permanecem válidos e equivalem a modalidade desconhecida. Pedidos já sincronizados serão enriquecidos gradualmente; não é necessária nova planilha para essa mudança.

## Interface

### Produtos e margem

Cada produto permite abrir seus anúncios e variações. A configuração mostra conta, identificador da oferta, SKU de custo, vigência e modalidade esperada (`Detectar pelo Mercado Livre`, `Full` ou `Comum`). O padrão é detectar. A lista mostra a modalidade efetiva e alerta quando a configuração diverge do envio.

### Conciliação

Um bloco `Fechamento Full mensal` mostra, por conta e mês:

- situação `Aberto`, `Provisório`, `Fechado` ou `Revisar`;
- unidades Full elegíveis;
- valor estimado durante o mês;
- campo para colar o total do demonstrativo;
- prévia do valor médio por unidade;
- confirmação com motivo;
- histórico de revisões.

Antes de fechar, um resumo informa quantas vendas e unidades serão incluídas, quais estão excluídas e por quê. O botão fica bloqueado quando não há unidades elegíveis ou existe conflito de despesa manual. Uma venda Full com despesa Full individual maior que zero precisa ter esse campo retirado antes do fechamento; uma cobrança excepcional pode ser registrada em `Outras despesas` com motivo, evitando dupla dedução.

### Indicadores e detalhe

Visão Geral, Vendas e Produtos usam a mesma projeção. A contribuição exibe selo `Provisória` quando depender da estimativa anterior e `Fechada` quando coberta pelo demonstrativo. O detalhe separa custo, imposto, frete, outras despesas e despesa Full, com sua origem.

## APIs e fluxo de dados

1. A sincronização recebe pedido e envio, busca o detalhe logístico e persiste o tipo normalizado junto à linha de venda.
2. A leitura do workspace aplica vínculos, ajustes individuais e fechamentos mensais em uma projeção única.
3. A API de configuração de produto salva SKU e modalidade esperada com vigência e revisão.
4. A API de fechamento calcula a elegibilidade no servidor, confere a assinatura das fontes e grava cabeçalho e parcelas atomicamente.
5. Após salvar, a interface recarrega o workspace sem cache. Todos os indicadores derivam da resposta atualizada.

A API nunca aceita uma lista de parcelas calculada pelo navegador. O cliente envia mês, total, revisão esperada e motivo; o servidor recalcula vendas, unidades e centavos para impedir adulteração ou inconsistência.

## Falhas e recuperação

- Falha ao consultar o detalhe do envio mantém a venda e agenda novo enriquecimento; não presume Full.
- Alteração concorrente retorna conflito e pede recarga, sem duplicar fechamento.
- Soma divergente ou venda de outra conta aborta a transação inteira.
- Um mês marcado para revisão não usa silenciosamente a nova composição.
- Fechamento sem mês anterior funciona; apenas a estimativa do primeiro mês fica indisponível.
- A retirada de um fechamento cria nova revisão auditável e restaura o estado aberto.

## Verificação e critérios de aceitação

1. Anúncio Full e anúncio comum do SKU 64265 usam o mesmo custo, mas apenas a venda Full recebe despesa mensal.
2. O tipo oficial `fulfillment` classifica a venda como Full; uma configuração divergente gera aviso e não substitui o dado oficial.
3. Um total de R$ 10.000,00 para 200 unidades gera parcelas cuja soma é exatamente R$ 10.000,00.
4. Uma venda de duas unidades recebe o dobro da parcela de uma unidade, incluindo rateio determinístico de centavos.
5. Conta, mês, anúncio e variação não vazam regras nem valores entre si.
6. Cancelamento, reembolso ou alteração de quantidade após o fechamento marca a revisão para conferência.
7. Um mês aberto usa a taxa unitária do último fechamento da mesma conta e mostra resultado provisório.
8. Sem fechamento anterior, a despesa Full fica pendente em vez de zero.
9. Ajuste manual e rateio mensal nunca deduzem a mesma despesa duas vezes.
10. Salvar uma conciliação completa, recarregar o workspace e reabrir Visão Geral, Vendas e Produtos altera todos os indicadores esperados.
11. APIs recusam outro proprietário, revisão concorrente e reenvio duplicado sem perder histórico.
12. Testes de domínio, API local, TypeScript, build e revisão visual em desktop e celular passam antes da publicação.

## Fora deste incremento

- Importar arquivo detalhado de despesas Full, pois o demonstrativo disponível contém somente o total.
- Inferir despesas por título, preço, descrição ou similaridade de SKU.
- Cadastrar pesos gerenciais diferentes por produto.
- Ratear armazenamento por estoque médio ou dias armazenados.
- Alterar anúncios, estoque ou modalidade logística no Mercado Livre.

## Referências oficiais

- Mercado Livre, Gestão Mercado Envios: https://developers.mercadolivre.com.br/pt_br/mercado-envios
- Mercado Livre, Gerenciamento de Envios: https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-envios
- Mercado Livre, Envios Fulfillment: https://developers.mercadolivre.com.br/envios-fulfillment
