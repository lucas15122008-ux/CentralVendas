'use client';
import {useRef,useState} from 'react';
import {Button} from '@/components/ui/button';import {Textarea} from '@/components/ui/textarea';
import {Bot,Send,LoaderCircle,RotateCcw,Info} from 'lucide-react';

type Message={role:'user'|'assistant';content:string};
const suggestions=['Como foi minha margem nos últimos 7 dias?','Quais anúncios estão dando prejuízo depois dos Ads?','O que devo resolver primeiro nas pendências?','Quais produtos mais contribuíram este mês?'];

export function AssistantView({demo}:{demo:boolean}){
 const [messages,setMessages]=useState<Message[]>([]);const [draft,setDraft]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const end=useRef<HTMLDivElement>(null);
 async function send(text:string){
  const content=text.trim();if(!content||busy)return;
  // Only the most recent turns go to the server, which caps the history it accepts.
  const next=[...messages,{role:'user' as const,content}].slice(-19);
  const history=next[0].role==='user'?next:next.slice(1);
  setMessages(next);setDraft('');setBusy(true);setError('');
  requestAnimationFrame(()=>end.current?.scrollIntoView({behavior:'smooth'}));
  try{
   const r=await fetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history})});
   const data=await r.json() as {reply?:string;error?:string};
   if(!r.ok||!data.reply)throw Error(data.error||'O agente não respondeu.');
   setMessages(current=>[...current,{role:'assistant',content:data.reply!}]);
  }catch(e){setError(e instanceof Error?e.message:'O agente não respondeu.');setMessages(current=>current.slice(0,-1));setDraft(content);}
  finally{setBusy(false);requestAnimationFrame(()=>end.current?.scrollIntoView({behavior:'smooth'}));}
 }
 if(demo)return <section className="panel empty-onboarding"><span className="large-icon"><Bot/></span><h2>Pergunte sobre sua operação</h2><p>O agente de IA responde perguntas sobre vendas, margens, publicidade e pendências usando os dados reais da Central. Ele fica disponível em Minha operação.</p></section>;
 return <section className="panel assistant-panel">
  <div className="panel-heading"><div><h2>Agente de IA</h2><p>Pergunte sobre vendas, margens, publicidade e pendências. Ele só consulta, não altera nada.</p></div>{messages.length>0&&<Button variant="ghost" size="sm" disabled={busy} onClick={()=>{setMessages([]);setError('')}}><RotateCcw/>Nova conversa</Button>}</div>
  <div className="assistant-thread" aria-live="polite">
   {!messages.length&&<div className="assistant-suggestions">{suggestions.map(item=><button key={item} onClick={()=>void send(item)}>{item}</button>)}</div>}
   {messages.map((message,index)=><div key={index} className={'assistant-message '+message.role}>{message.role==='assistant'&&<span className="assistant-avatar"><Bot size={16}/></span>}<p>{message.content}</p></div>)}
   {busy&&<div className="assistant-message assistant"><span className="assistant-avatar"><Bot size={16}/></span><p className="muted"><LoaderCircle className="animate-spin inline" size={14}/> Consultando seus dados…</p></div>}
   <div ref={end}/>
  </div>
  {error&&<p className="error-box assistant-error" role="alert">{error}</p>}
  <form className="assistant-input" onSubmit={e=>{e.preventDefault();void send(draft)}}>
   <Textarea aria-label="Pergunta para o agente" placeholder="Ex.: qual anúncio teve o maior ACOS na última semana?" value={draft} maxLength={4000} rows={2} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send(draft)}}}/>
   <Button type="submit" disabled={busy||!draft.trim()} aria-label="Enviar pergunta">{busy?<LoaderCircle className="animate-spin"/>:<Send/>}</Button>
  </form>
  <div className="note assistant-note"><Info size={15}/><p>As respostas usam os mesmos números das telas da Central. Confira os valores antes de tomar decisões importantes.</p></div>
 </section>;
}
