'use client';
import {FullClosurePanel} from './full-closure-panel';
import type {Account,FullClosureSummary} from '@/lib/demo';
import {Info,Warehouse} from 'lucide-react';

export function FullExpensesView({accounts,closures,demo,onReload}:{accounts:Account[];closures:FullClosureSummary[];demo:boolean;onReload:()=>Promise<void>}){
 return <><section className="full-expenses-intro"><span><Warehouse/></span><div><h2>Rateio mensal das despesas do Full</h2><p>Cole o total do demonstrativo mensal. O sistema distribui os centavos pelas unidades Full elegíveis e atualiza as vendas automaticamente.</p></div></section><FullClosurePanel accounts={accounts} closures={closures} demo={demo} onReload={onReload}/><div className="note"><Info size={17}/><p>Tarifas, frete e descontos de cada pedido continuam vindo da API. Este total cobre as despesas mensais que o Mercado Livre informa apenas no demonstrativo.</p></div></>;
}
