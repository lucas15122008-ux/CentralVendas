# Conciliação de vendas — plano de implantação

Desenho aprovado na conversa; execução solicitada em 17/09. SKU 64265: mesmo custo de produto, preço e despesas diferentes no Full. Preservar escopos do Mercado Livre.

**Objetivo:** associar produtos vendidos à planilha e permitir composição manual dos valores de cada item vendido, com histórico persistente.

**Arquitetura:** dados originais do Mercado Livre ficam intactos. Eventos de conciliação e vínculos são registrados em tabela separada, filtrada pelo proprietário e conta. A consulta da operação aplica a última revisão e alimenta todos os indicadores com o mesmo cálculo. Novos dados da venda ou do custo invalidam a revisão manual e exibem pendência.

**Restrições:** BRL em centavos, custo unitário com quatro casas; conta/SKU/variação e vigência explícitos; nenhum custo atual aplicado automaticamente ao passado; nenhum preço de venda usado para inferir custo ou Full. Full é classificação manual por venda nesta etapa, com despesas adicionais explícitas, sem inventar cobrança do provedor. Reembolso exige custo consumido e receita residual confirmados. Dados desconhecidos permanecem nulos.

## Entregas

- [ ] Domínio: testes de vínculo com vigência e isolamento; custo igual em vendas de preços diferentes; despesa Full deduzida uma vez; ajuste parcial; invalidação por mudança e preservação dos originais. Implementar tipos e projeção em `lib/reconciliation.ts`, integrar `lib/finance.ts`.
- [ ] Persistência: tabela append-only `reconciliation_events` e migração gerada, serviço `lib/reconciliation-store.ts` e rota `/api/reconciliation`. Testar propriedade, conflito de revisão, reenvio idempotente, retirada auditável e escrita concorrente com atualização da venda. A escrita usa INSERT SELECT condicionado ao documento original e à revisão esperada.
- [ ] Interface: `components/reconciliation-view.tsx`, navegação Conciliação, busca/estado/conta/período, editor de totais por item, classificação Full manual e histórico. Vincular anúncio/variação a SKU com vigência e confirmação. Campos vazios permanecem desconhecidos. Mostrar origem e motivo do ajuste.
- [ ] Verificação: executar testes de domínio/serviço e API local, TypeScript, build e revisão visual desktop/mobile. Publicar no mesmo Site privado e conferir sucesso da migração/publicação.

## Contratos

`ReconciliationAmounts`: revenueCents, feeCents, shippingCents, otherCents, costCents, taxCents, fullExpenseCents — inteiros não negativos ou null. Todos são totais do item vendido, não do pedido nem unitários.

`ProductLink`: conta, anúncio, variação, SKU de custo, validFrom. Usa o custo vigente para a data da venda e nunca se baseia no título/preço.

`ReconciliationEvent`: seq, requestId, accountId, kind (sale/product), targetKey, payload, reason, createdAt. Payload null retira a revisão/vínculo, preservando eventos anteriores. Controle de concorrência por última seq por targetKey; eventos da conta vizinha não são consultados.

`sourceStamp`: serialização dos campos materiais da venda e do custo vigente. Ajuste só é aplicado quando o stamp confirmado ainda coincide. A API retorna stamp e última revisão; o formulário envia ambos.

## Critérios de aceitação

1. Venda comum de 200 e Full de 250 usam o mesmo custo 100; Full com despesa 15 deduz 15 só na venda Full.
2. Vínculo não alcança outra conta/variação nem data anterior à vigência.
3. Atualizar quantidade, status, receita, tarifa, frete ou custo torna o ajuste anterior pendente.
4. Reenvio não duplica; edição de outra aba ou sincronização simultânea retorna conflito sem perder histórico.
5. Restaurar valores automáticos é evento auditável; sincronizar nunca apaga ajuste.
6. Visão geral, Vendas e Produtos usam os mesmos valores conciliados.
