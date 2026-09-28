'use client';
import {Button} from '@/components/ui/button';
import {money} from '@/lib/finance';
import type {Insight} from '@/lib/insights';
import type {Account} from '@/lib/demo';
import {CircleAlert,TriangleAlert,Info,ArrowRight,Lightbulb} from 'lucide-react';

const actionLabels:Record<Insight['action'],string>={advertising:'Abrir Publicidade',ads:'Abrir Anúncios',pending:'Abrir Pendências',sales:'Abrir Vendas'};

export function InsightsView({insights,accounts,onAction}:{insights:Insight[];accounts:Account[];onAction:(action:Insight['action'])=>void}){
 const critical=insights.filter(item=>item.severity==='critical'),warnings=insights.filter(item=>item.severity==='warning');
 const impact=insights.reduce((sum,item)=>sum+Math.max(0,item.impactCents),0);
 if(!insights.length)return <section className="panel empty-onboarding"><span className="large-icon"><Lightbulb/></span><h2>Nada pedindo atenção agora</h2><p>A Central confere margens, publicidade e ritmo de vendas dos últimos 30 dias a cada atualização. Os alertas aparecem aqui quando algo sair do esperado.</p></section>;
 return <>
  <div className="metric-grid insights-metrics">
   <section className="metric-card primary-metric"><div className="metric-label">Alertas críticos <CircleAlert size={18}/></div><strong>{critical.length}</strong><div className="metric-foot"><span>Anúncios dando prejuízo</span></div></section>
   <section className="metric-card"><div className="metric-label">Atenção <TriangleAlert size={18}/></div><strong>{warnings.length}</strong><div className="metric-foot"><span className="muted">Margem baixa, queda ou Ads sem venda</span></div></section>
   <section className="metric-card"><div className="metric-label">Impacto estimado <Lightbulb size={18}/></div><strong>{money(impact)}</strong><div className="metric-foot"><span className="muted">Nos últimos 30 dias</span></div></section>
  </div>
  <section className="panel insight-list">
   {insights.map(item=>{const Icon=item.severity==='critical'?CircleAlert:item.severity==='warning'?TriangleAlert:Info;return <article className={'insight-row '+item.severity} key={item.id}>
    <span className="insight-icon"><Icon size={18}/></span>
    <div className="insight-body"><strong>{item.title}</strong><p>{item.detail}</p><small>{item.accountId?accounts.find(a=>a.id===item.accountId)?.name:'Todas as contas'}{item.itemId?' · '+item.itemId:''}</small></div>
    <Button variant="outline" size="sm" onClick={()=>onAction(item.action)}>{actionLabels[item.action]}<ArrowRight/></Button>
   </article>})}
  </section>
  <div className="note"><Info size={15}/><p>Os alertas usam apenas vendas com resultado completo. Vendas com pendências ficam de fora até serem resolvidas.</p></div>
 </>;
}
