import Anthropic from '@anthropic-ai/sdk';
import {betaZodTool} from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import {businessDate} from './dates.ts';
import {advertisingReport,insightList,pendingReport,periodSummary,productRanking,searchSales,type AssistantData} from './assistant-tools.ts';

export const ASSISTANT_MODEL='claude-opus-5';
export const MAX_HISTORY=20;
export const MAX_MESSAGE_CHARS=4000;

export type ChatMessage={role:'user'|'assistant';content:string};
export const chatSchema=z.object({messages:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().trim().min(1).max(MAX_MESSAGE_CHARS)})).min(1).max(MAX_HISTORY)}).refine(value=>value.messages[0].role==='user'&&value.messages.at(-1)!.role==='user');

const days=z.number().int().min(1).max(365).optional().describe('Quantidade de dias até hoje. Padrão 30.');
const account=z.string().max(100).optional().describe('Nome ou id da conta. Omita para todas as contas.');

function system(data:AssistantData){
 const today=businessDate(data.now);
 return `Você é o agente de IA da Central de Vendas, o painel financeiro privado de um vendedor do Mercado Livre. Hoje é ${today} (horário de Brasília). Contas: ${data.accounts.map(item=>item.name).join(', ')||'nenhuma'}.

Responda sempre em português do Brasil, direto e em poucas frases, como um analista financeiro que conhece a operação. Use as ferramentas para buscar os números; nunca invente valores. Quando citar um número, diga o período. Valores monetários vêm em reais.

Como a Central calcula:
- Contribuição = receita líquida menos tarifa, frete do vendedor, outras despesas, custo do produto, imposto adicional e despesa Full. É anterior à publicidade e às despesas fixas.
- Publicidade (Mercado Ads) é cobrada por clique no anúncio, então é descontada no total do anúncio e do período ("contribuição após Ads"), não em cada venda.
- Vendas com pendências ficam sem resultado (contribuição nula) até o vendedor resolver; avise quando a cobertura for baixa.
- ACOS = investimento em Ads / vendas atribuídas. TACOS = investimento / receita total do anúncio.

Você só consulta dados: não altera fichas, vendas ou configurações. Se pedirem uma mudança, explique onde fazer na Central (Anúncios, Pendências, Publicidade, Despesas Full, Minhas contas).`;
}

function tools(data:AssistantData){
 const json=(value:unknown)=>JSON.stringify(value);
 const safe=(run:()=>unknown)=>{try{return json(run());}catch(error){return json({erro:error instanceof Error?error.message:'Consulta inválida.'});}};
 return [
  betaZodTool({name:'resumo_periodo',description:'Faturamento, receita, contribuição, margem, investimento em Ads, contribuição após Ads e cobertura de um período.',inputSchema:z.object({dias:days,conta:account}),run:input=>safe(()=>periodSummary(data,input))}),
  betaZodTool({name:'ranking_produtos',description:'Produtos (por SKU) ordenados por contribuição, receita, unidades ou maior prejuízo no período.',inputSchema:z.object({dias:days,conta:account,ordenar:z.enum(['contribuicao','receita','unidades','prejuizo']).optional(),limite:z.number().int().min(1).max(50).optional()}),run:input=>safe(()=>productRanking(data,input))}),
  betaZodTool({name:'publicidade',description:'Investimento no Mercado Ads, vendas atribuídas, ACOS, TACOS e contribuição após Ads por anúncio (até 30 dias).',inputSchema:z.object({dias:days,conta:account,limite:z.number().int().min(1).max(50).optional()}),run:input=>safe(()=>advertisingReport(data,input))}),
  betaZodTool({name:'alertas',description:'Alertas atuais da tela Insights: anúncios com prejuízo, Ads que consomem a margem, Ads sem venda, margem baixa, queda de vendas e anúncios parados.',inputSchema:z.object({conta:account}),run:input=>safe(()=>insightList(data,input))}),
  betaZodTool({name:'pendencias',description:'Pendências que impedem o cálculo da margem (fichas sem custo, campos não confirmados, fechamentos Full).',inputSchema:z.object({conta:account}),run:input=>safe(()=>pendingReport(data,input))}),
  betaZodTool({name:'buscar_vendas',description:'Busca vendas por SKU, título, número do pedido ou anúncio e mostra a composição do resultado de cada uma.',inputSchema:z.object({texto:z.string().min(1).max(200),dias:days,conta:account,limite:z.number().int().min(1).max(30).optional()}),run:input=>safe(()=>searchSales(data,input))}),
 ];
}

export async function askAssistant(apiKey:string,data:AssistantData,messages:ChatMessage[],fetcher?:typeof fetch):Promise<string>{
 const client=new Anthropic({apiKey,maxRetries:1,...(fetcher?{fetch:fetcher}:{})});
 const final=await client.beta.messages.toolRunner({
  model:ASSISTANT_MODEL,
  max_tokens:16000,
  max_iterations:8,
  thinking:{type:'adaptive'},
  betas:['server-side-fallback-2026-07-01'],
  fallbacks:'default',
  system:system(data),
  tools:tools(data),
  messages:messages.map(message=>({role:message.role,content:message.content})),
 });
 if(final.stop_reason==='refusal')return 'Não consigo responder a essa pergunta. Tente reformular focando nos dados da sua operação.';
 const text=final.content.flatMap(block=>block.type==='text'?[block.text]:[]).join('\n').trim();
 if(final.stop_reason==='max_tokens')return (text?text+'\n\n':'')+'(Resposta interrompida por ser longa demais. Peça um recorte menor.)';
 return text||'Não encontrei uma resposta. Tente perguntar de outro jeito.';
}
