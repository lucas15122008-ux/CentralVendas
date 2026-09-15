import {z} from 'zod';
import {randomToken,seal,unseal,pkceChallenge} from './crypto.ts';
import {authorizationUrl,remoteId,orderSchema,normalizeOrders,type MeliOrder,type ShipmentCost} from './protocol.ts';
export const CALLBACK_URL='https://central-vendas-lucas.kisashi.chatgpt.site/api/meli/callback';
export class MeliError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status;}}
const configSchema=z.object({clientId:z.string().trim().regex(/^\d{3,30}$/),clientSecret:z.string().trim().min(8).max(500),pkce:z.boolean()});
const tokenSchema=z.object({access_token:z.string().min(1).max(10000),refresh_token:z.string().min(1).max(10000),expires_in:z.number().int().positive().max(86400*365),user_id:remoteId});
type App={owner_id:string;client_id:string;secret:string;pkce:number;revision:string};
type Connection={account_id:string;owner_id:string;seller_id:string|null;nickname:string|null;status:string;generation:string;tokens:string|null;expires_at:number|null;refresh_started:number|null};
type Flow={account_id:string;generation:string;app_revision:string;verifier:string};
type Run={id:string;account_id:string;owner_id:string;generation:string;from_date:string;to_date:string;offset:number;total:number|null;status:string;lease:string|null;lease_until:number|null;error:string|null;updated_at:number};
type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export class MeliService {
 db:D1Database;key:string;fetcher:Fetcher;now:()=>number;
 // Calling native Worker fetch as this.fetcher changes its receiver and throws Illegal invocation.
 constructor(db:D1Database,key:string,fetcher:Fetcher=(url,init)=>fetch(url,init),now:()=>number=Date.now){this.db=db;this.key=key;this.fetcher=fetcher;this.now=now;}
 async account(owner:string,id:string){const row=await this.db.prepare('SELECT id FROM accounts WHERE id=? AND owner_id=?').bind(id,owner).first();if(!row)throw new MeliError(404,'Conta não encontrada.');}
 async app(owner:string){if(!this.key)throw new MeliError(503,'A proteção da conexão ainda não foi configurada.');const app=await this.db.prepare('SELECT * FROM meli_apps WHERE owner_id=?').bind(owner).first<App>();if(!app)throw new MeliError(409,'Configure sua aplicação antes de conectar.');return app;}
 async connection(owner:string,id:string){await this.account(owner,id);const row=await this.db.prepare('SELECT * FROM meli_connections WHERE owner_id=? AND account_id=?').bind(owner,id).first<Connection>();if(!row)throw new MeliError(409,'Autorize esta conta no Mercado Livre.');return row;}
 async status(owner:string){
  const app=await this.db.prepare('SELECT client_id,pkce FROM meli_apps WHERE owner_id=?').bind(owner).first<{client_id:string;pkce:number}>();
  const connections=await this.db.prepare('SELECT c.account_id AS accountId,c.seller_id AS sellerId,c.nickname,c.status,c.updated_at AS updatedAt,c.synced_at AS syncedAt,r.status AS syncStatus,r.offset AS processed,r.total,r.error,r.from_date AS fromDate,r.to_date AS toDate FROM meli_connections c LEFT JOIN meli_sync_runs r ON r.account_id=c.account_id AND r.owner_id=c.owner_id AND r.generation=c.generation WHERE c.owner_id=?').bind(owner).all<{accountId:string;sellerId:string|null;nickname:string|null;status:string;updatedAt:number;syncedAt:number|null;syncStatus:string|null;processed:number|null;total:number|null;error:string|null;fromDate:string|null;toDate:string|null}>();
  return {app:{configured:!!app,secureReady:!!this.key,clientId:app?.client_id??'',pkce:!!app?.pkce,callbackUrl:CALLBACK_URL},connections:connections.results};
 }
 async configure(owner:string,input:unknown){
  if(!this.key)throw new MeliError(503,'A proteção da conexão ainda não foi configurada.');
  const result=configSchema.safeParse(input);if(!result.success)throw new MeliError(400,'Informe Client ID numérico, Client Secret e a opção PKCE.');const value=result.data;
  const secret=await seal(value.clientSecret,this.key,owner+'/app');const revision=randomToken();
  const saved=await this.db.prepare("INSERT INTO meli_apps(owner_id,client_id,secret,pkce,revision,updated_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM meli_connections WHERE owner_id=? AND status IN ('connected','refreshing','authorizing')) ON CONFLICT(owner_id) DO UPDATE SET client_id=excluded.client_id,secret=excluded.secret,pkce=excluded.pkce,revision=excluded.revision,updated_at=excluded.updated_at WHERE NOT EXISTS(SELECT 1 FROM meli_connections WHERE owner_id=? AND status IN ('connected','refreshing','authorizing')) RETURNING owner_id").bind(owner,value.clientId,secret,value.pkce?1:0,revision,this.now(),owner,owner).first();
  if(!saved)throw new MeliError(409,'Desconecte as contas antes de trocar a aplicação. Os custos e as vendas serão preservados.');
 }
 async connect(owner:string,id:string){
  await this.account(owner,id);const app=await this.app(owner);const generation=randomToken(),state=randomToken(),browser=randomToken(),verifier=randomToken();const stateHash=await hash(state);
  const encrypted=await seal(verifier,this.key,owner+'/state/'+stateHash);
  const results=await this.db.batch([
   this.db.prepare('DELETE FROM meli_oauth_states WHERE expires_at<? OR (owner_id=? AND account_id=?)').bind(this.now(),owner,id),
   this.db.prepare("INSERT INTO meli_connections(account_id,owner_id,status,generation,updated_at) SELECT ?,?,'authorizing',?,? WHERE EXISTS(SELECT 1 FROM meli_apps WHERE owner_id=? AND revision=?) ON CONFLICT(account_id) DO UPDATE SET status='authorizing',generation=excluded.generation,tokens=NULL,expires_at=NULL,refresh_started=NULL,updated_at=excluded.updated_at RETURNING account_id").bind(id,owner,generation,this.now(),owner,app.revision),
   this.db.prepare('INSERT INTO meli_oauth_states(state_hash,owner_id,account_id,browser_hash,verifier,generation,app_revision,expires_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM meli_connections WHERE account_id=? AND owner_id=? AND generation=?)').bind(stateHash,owner,id,await hash(browser),encrypted,generation,app.revision,this.now()+600000,id,owner,generation)
  ]);
  if(!results[1].results.length)throw new MeliError(409,'A configuração mudou. Inicie a conexão novamente.');
  return {url:authorizationUrl({clientId:app.client_id,redirectUri:CALLBACK_URL,pkce:!!app.pkce},state,await pkceChallenge(verifier)),state,browser};
 }
 async remote(path:string,token?:string,body?:URLSearchParams){
  // Workers supports manual/follow only. Manual redirects reach the non-2xx rejection below;
  // credentials are never forwarded to the Location target.
  let response:Response;
  try{response=await this.fetcher('https://api.mercadolibre.com'+path,{method:body?'POST':'GET',redirect:'manual',signal:AbortSignal.timeout(12000),headers:{Accept:'application/json','x-format-new':'true',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(body?{body:body.toString()}:{})});}catch{throw new MeliError(502,'O Mercado Livre não respondeu. Tente retomar a atualização.');}
  if(!response.ok){
   const status=response.status;
   const sensitive=[token,...['client_secret','code','refresh_token','access_token'].map(key=>body?.get(key))].filter((s):s is string=>!!s);
   const clean=(value:unknown)=>{if(typeof value!=='string')return undefined;for(const secret of sensitive)value=(value as string).split(secret).join('[redacted]').split(encodeURIComponent(secret)).join('[redacted]');return (value as string).replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[redacted]').replace(/[\r\n\t]/g,' ').slice(0,500);};
   // Only allow diagnostic fields. Never log headers, query parameters or response payloads.
   let detail:Record<string,unknown>={};
   try{const data=await response.json();if(data&&typeof data==='object'&&!Array.isArray(data))detail=data as Record<string,unknown>;}catch{/* Non-JSON responses are identified by resource and status only. */}
   console.error('meli_upstream_error',{resource:path.split('?')[0].replace(/\/\d+(?=\/|$)/g,'/:id'),status,code:clean(detail.error),message:clean(detail.message)});
   throw new MeliError(status===401?401:status===403?403:status===404?404:status===429?429:502,status===401?'A autorização expirou. Reconecte esta conta.':status===403?'A aplicação não tem acesso a este recurso. Confira as permissões no Mercado Livre.':status===429?'O Mercado Livre pediu uma pausa. Retome a atualização em alguns minutos.':'Não foi possível consultar este recurso no Mercado Livre.');
  }
  try{return await response.json() as unknown}catch{throw new MeliError(502,'O Mercado Livre retornou dados incompletos. Tente novamente.');}
 }
 async exchange(app:App,fields:Record<string,string>){
  const secret=await unseal(app.secret,this.key,app.owner_id+'/app');
  const result=tokenSchema.safeParse(await this.remote('/oauth/token',undefined,new URLSearchParams({client_id:app.client_id,client_secret:secret,...fields})));
  if(!result.success)throw new MeliError(502,'Não foi possível confirmar a autorização. Reconecte a conta.');return result.data;
 }
 async callback(owner:string,state:string,browser:string,code:string|null){
  if(!state||state.length>200||!browser||browser.length>200)throw new MeliError(400,'A autorização não corresponde a este navegador. Inicie novamente.');
  const stateHash=await hash(state);
  const flow=await this.db.prepare('DELETE FROM meli_oauth_states WHERE state_hash=? AND owner_id=? AND browser_hash=? AND expires_at>? RETURNING account_id,generation,app_revision,verifier').bind(stateHash,owner,await hash(browser),this.now()).first<Flow>();
  if(!flow)throw new MeliError(400,'Autorização expirada ou já utilizada. Inicie a conexão novamente.');
  try{
   const app=await this.app(owner);const connection=await this.connection(owner,flow.account_id);
   if(app.revision!==flow.app_revision||connection.generation!==flow.generation||connection.status!=='authorizing')throw new MeliError(409,'Esta tentativa de conexão foi substituída.');
   if(!code||code.length>3000)throw new MeliError(400,'A autorização foi cancelada. Você pode conectar novamente.');
   const verifier=await unseal(flow.verifier,this.key,owner+'/state/'+stateHash);
   const tokens=await this.exchange(app,{grant_type:'authorization_code',code,redirect_uri:CALLBACK_URL,...(app.pkce?{code_verifier:verifier}:{})});
   const user=z.object({id:remoteId,nickname:z.string().max(200),site_id:z.literal('MLB')}).safeParse(await this.remote('/users/me',tokens.access_token));
   if(!user.success||user.data.id!==tokens.user_id)throw new MeliError(400,'Autorize uma conta de vendedor do Mercado Livre Brasil.');
   if(connection.seller_id&&connection.seller_id!==user.data.id)throw new MeliError(409,'Esta conta já pertence a outro vendedor. Crie uma nova conta de trabalho para manter os custos separados.');
   const duplicate=await this.db.prepare('SELECT account_id FROM meli_connections WHERE owner_id=? AND seller_id=? AND account_id<>?').bind(owner,user.data.id,flow.account_id).first();
   if(duplicate)throw new MeliError(409,'Este vendedor já está associado a outra conta de trabalho.');
   const encrypted=await seal(JSON.stringify(tokens),this.key,owner+'/tokens/'+flow.account_id);
   let saved;
   try{saved=await this.db.prepare("UPDATE meli_connections SET seller_id=?,nickname=?,tokens=?,expires_at=?,status='connected',refresh_started=NULL,updated_at=? WHERE account_id=? AND owner_id=? AND generation=? AND status='authorizing' AND EXISTS(SELECT 1 FROM meli_apps WHERE owner_id=? AND revision=?) RETURNING account_id").bind(user.data.id,user.data.nickname,encrypted,this.now()+tokens.expires_in*1000,this.now(),flow.account_id,owner,flow.generation,owner,flow.app_revision).first();}catch{throw new MeliError(409,'Não foi possível associar este vendedor. Confira se ele já está em outra conta.');}
   if(!saved)throw new MeliError(409,'A conexão foi cancelada ou substituída.');
  }catch(error){await this.db.prepare("UPDATE meli_connections SET status='reconnect',tokens=NULL,updated_at=? WHERE account_id=? AND owner_id=? AND generation=? AND status='authorizing'").bind(this.now(),flow.account_id,owner,flow.generation).run();throw error;}
 }
 async disconnect(owner:string,id:string){
  await this.account(owner,id);
  await this.db.batch([this.db.prepare('DELETE FROM meli_oauth_states WHERE owner_id=? AND account_id=?').bind(owner,id),this.db.prepare("UPDATE meli_connections SET status='disconnected',tokens=NULL,expires_at=NULL,refresh_started=NULL,generation=?,updated_at=? WHERE owner_id=? AND account_id=?").bind(randomToken(),this.now(),owner,id),this.db.prepare("UPDATE meli_sync_runs SET status='paused',lease=NULL,lease_until=NULL WHERE owner_id=? AND account_id=?").bind(owner,id)]);
 }
 async accessToken(owner:string,id:string){
  const c=await this.connection(owner,id);
  if(c.status==='refreshing'){
   if((c.refresh_started??0)<this.now()-60000)await this.db.prepare("UPDATE meli_connections SET status='reconnect',tokens=NULL WHERE owner_id=? AND account_id=? AND generation=? AND status='refreshing' AND refresh_started<?").bind(owner,id,c.generation,this.now()-60000).run();
   throw new MeliError(409,(c.refresh_started??0)<this.now()-60000?'A renovação foi interrompida. Reconecte a conta.':'A autorização está sendo renovada. Tente em alguns instantes.');
  }
  if(c.status!=='connected'||!c.tokens)throw new MeliError(409,'Reconecte esta conta ao Mercado Livre.');
  const tokens=tokenSchema.parse(JSON.parse(await unseal(c.tokens,this.key,owner+'/tokens/'+id)));
  if((c.expires_at??0)>this.now()+60000)return tokens.access_token;
  const app=await this.app(owner);
  const locked=await this.db.prepare("UPDATE meli_connections SET status='refreshing',refresh_started=? WHERE owner_id=? AND account_id=? AND generation=? AND tokens=? AND status='connected' RETURNING account_id").bind(this.now(),owner,id,c.generation,c.tokens).first();
  if(!locked)throw new MeliError(409,'Outra atualização está renovando a autorização. Tente novamente.');
  // Persist the attempt before sending a single-use refresh token. An abandoned attempt is never retried.
  try{
   const next=await this.exchange(app,{grant_type:'refresh_token',refresh_token:tokens.refresh_token});
   if(next.user_id!==c.seller_id)throw new MeliError(409,'Não foi possível confirmar o vendedor. Reconecte a conta.');
   const encrypted=await seal(JSON.stringify(next),this.key,owner+'/tokens/'+id);
   const saved=await this.db.prepare("UPDATE meli_connections SET tokens=?,expires_at=?,status='connected',refresh_started=NULL,updated_at=? WHERE owner_id=? AND account_id=? AND generation=? AND tokens=? AND status='refreshing' RETURNING account_id").bind(encrypted,this.now()+next.expires_in*1000,this.now(),owner,id,c.generation,c.tokens).first();
   if(!saved)throw new MeliError(409,'A conexão foi cancelada durante a renovação.');return next.access_token;
  }catch(error){await this.db.prepare("UPDATE meli_connections SET status='reconnect',tokens=NULL,updated_at=? WHERE owner_id=? AND account_id=? AND generation=? AND tokens=? AND status='refreshing'").bind(this.now(),owner,id,c.generation,c.tokens).run();throw error;}
 }
 async sync(owner:string,id:string){
  const token=await this.accessToken(owner,id);const c=await this.connection(owner,id);if(!c.seller_id)throw new MeliError(409,'Autorize o vendedor.');
  const now=this.now(),runId=randomToken(),lease=randomToken();
  // Fixed 30-day window includes the current hour; repeated updates reconcile the full window.
  const from=new Date(now-30*86400000);from.setUTCMinutes(0,0,0);const to=new Date(now+3600000);to.setUTCMinutes(0,0,0);
  await this.db.prepare("INSERT INTO meli_sync_runs(account_id,owner_id,generation,id,from_date,to_date,offset,status,updated_at) VALUES(?,?,?,?,?,?,0,'running',?) ON CONFLICT(account_id) DO UPDATE SET generation=excluded.generation,id=excluded.id,from_date=excluded.from_date,to_date=excluded.to_date,offset=0,total=NULL,status='running',lease=NULL,lease_until=NULL,error=NULL,updated_at=excluded.updated_at WHERE meli_sync_runs.status='complete' OR meli_sync_runs.generation<>excluded.generation").bind(id,owner,c.generation,runId,from.toISOString(),to.toISOString(),now).run();
  const run=await this.db.prepare("UPDATE meli_sync_runs SET lease=?,lease_until=?,status='running',error=NULL,updated_at=? WHERE account_id=? AND owner_id=? AND generation=? AND (lease_until IS NULL OR lease_until<?) RETURNING *").bind(lease,now+90000,now,id,owner,c.generation,now).first<Run>();
  if(!run)throw new MeliError(409,'Esta conta já está atualizando em outra aba. Aguarde a conclusão do lote.');
  const guard="EXISTS(SELECT 1 FROM meli_sync_runs r JOIN meli_connections c ON c.account_id=r.account_id AND c.owner_id=r.owner_id WHERE r.account_id=? AND r.owner_id=? AND r.id=? AND r.lease=? AND r.generation=c.generation AND c.status='connected' AND r.lease_until>?)";
  const guardValues=()=>[id,owner,run.id,lease,this.now()];
  const get=async(path:string)=>{if(this.now()>now+60000)throw new MeliError(503,'O lote demorou além do esperado. Retome para tentar novamente.');return this.remote(path,token)};
  try{
   if(run.offset>=10000)throw new MeliError(409,'O limite de 10.000 pedidos desta atualização foi atingido. Os dados estão parciais; é necessário ampliar a sincronização por períodos.');
   // Seller and dates scope the search; no status allowlist can omit cancellations or send unsupported filters.
   const query=new URLSearchParams({seller:c.seller_id,sort:'date_asc',limit:'5',offset:String(run.offset),'order.date_created.from':run.from_date,'order.date_created.to':run.to_date});
   const search=z.object({results:z.array(orderSchema).max(5),paging:z.object({total:z.number().int().nonnegative(),offset:z.number().int().nonnegative()})}).safeParse(await get('/orders/search?'+query));
   if(!search.success||search.data.paging.offset!==run.offset)throw new MeliError(502,'O Mercado Livre retornou um lote incompleto. Retome a atualização.');
   if(!search.data.results.length&&run.offset<search.data.paging.total)throw new MeliError(502,'A lista de pedidos mudou durante a leitura. Tente retomar.');
   const orders=new Map<string,MeliOrder>();for(const order of search.data.results){if(order.seller.id!==c.seller_id)throw new MeliError(502,'Não foi possível confirmar o vendedor de um pedido.');orders.set(order.id,order);}
   const shipments:ShipmentCost[]=[];
   for(const shipmentId of new Set([...orders.values()].map(o=>o.shipping?.id).filter((s):s is string=>!!s))){
    const shipment:ShipmentCost={id:shipmentId,sellerCostCents:null,orderIds:[],complete:false};shipments.push(shipment);
    try{
     const items=z.array(z.object({order_id:remoteId,sender_id:remoteId,item_id:z.string(),variation_id:remoteId.nullish(),quantity:z.number().positive()})).min(1).max(50).parse(await get('/shipments/'+shipmentId+'/items'));
     if(items.some(i=>i.sender_id!==c.seller_id))continue;
     shipment.orderIds=[...new Set(items.map(i=>i.order_id))];
     if(shipment.orderIds.length>15||orders.size+shipment.orderIds.filter(orderId=>!orders.has(orderId)).length>20)continue;
     for(const orderId of shipment.orderIds){if(!orders.has(orderId)){const extra=orderSchema.parse(await get('/orders/'+orderId));if(extra.id!==orderId||extra.seller.id!==c.seller_id||extra.shipping?.id!==shipmentId)throw new MeliError(502,'Os pedidos de um envio não puderam ser confirmados.');orders.set(extra.id,extra);}}
     const expected=new Map<string,number>(),actual=new Map<string,number>();
     for(const orderId of shipment.orderIds)for(const line of orders.get(orderId)!.order_items){const key=JSON.stringify([orderId,line.item.id,line.item.variation_id??'0']);expected.set(key,(expected.get(key)??0)+line.quantity);}
     for(const item of items){const key=JSON.stringify([item.order_id,item.item_id,item.variation_id??'0']);actual.set(key,(actual.get(key)??0)+item.quantity);}
     if(expected.size!==actual.size||[...expected].some(([key,quantity])=>actual.get(key)!==quantity))continue;
     const costs=z.object({senders:z.array(z.object({user_id:remoteId,cost:z.number().finite().nonnegative().max(1e9)}))}).parse(await get('/shipments/'+shipmentId+'/costs'));
     const sender=costs.senders.filter(s=>s.user_id===c.seller_id);if(sender.length===1)shipment.sellerCostCents=Math.round(sender[0].cost*100);shipment.complete=true;
    }catch(error){if(error instanceof MeliError&&![403,404].includes(error.status))throw error;/* Unknown shipment data remains pending, never zero. */}
   }
   const discountState=new Map<string,'none'|'present'|'unknown'>();
   for(const order of orders.values()){
    try{const details=z.object({details:z.array(z.unknown())}).safeParse(await get('/orders/'+order.id+'/discounts'));discountState.set(order.id,details.success?(details.data.details.length?'present':'none'):'unknown');}
    catch(error){if(error instanceof MeliError&&![403,404].includes(error.status))throw error;discountState.set(order.id,'unknown');}
   }
   const rows=normalizeOrders(id,c.seller_id,[...orders.values()],shipments,discountState);
   const statements=[];
   // Save every member of each shipment in one D1 transaction, even outside the search page.
   for(const order of orders.values()){
    const lines=rows.filter(r=>r.orderId===order.id);
    statements.push(this.db.prepare(`INSERT INTO meli_orders(id,owner_id,account_id,order_id,date,data,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(account_id,order_id) DO UPDATE SET date=excluded.date,data=excluded.data,updated_at=excluded.updated_at`).bind(id+':'+order.id,owner,id,order.id,lines[0].date,JSON.stringify(lines),this.now(),...guardValues()));
   }
   const offset=run.offset+search.data.results.length,total=search.data.paging.total,status=offset>=total?'complete':'running';
   if(status==='complete')statements.push(this.db.prepare(`UPDATE meli_connections SET synced_at=? WHERE account_id=? AND owner_id=? AND ${guard}`).bind(this.now(),id,owner,...guardValues()));
   statements.push(this.db.prepare(`UPDATE meli_sync_runs SET offset=?,total=?,status=?,lease=NULL,lease_until=NULL,updated_at=? WHERE account_id=? AND owner_id=? AND ${guard} RETURNING *`).bind(offset,total,status,this.now(),id,owner,...guardValues()));
   const saved=await this.db.batch(statements);if(!saved.at(-1)?.results.length)throw new MeliError(409,'A atualização foi cancelada ou substituída. Os dados anteriores foram preservados.');
   return {status,processed:offset,total,fromDate:run.from_date,toDate:run.to_date};
  }catch(error){
   const message=error instanceof MeliError?error.message:'O lote contém dados incompletos. Retome a atualização.';
   await this.db.prepare("UPDATE meli_sync_runs SET status='paused',error=?,lease=NULL,lease_until=NULL,updated_at=? WHERE owner_id=? AND account_id=? AND id=? AND lease=?").bind(message,this.now(),owner,id,run.id,lease).run();
   if(error instanceof MeliError&&error.status===401)await this.db.prepare("UPDATE meli_connections SET status='reconnect',tokens=NULL WHERE owner_id=? AND account_id=? AND generation=?").bind(owner,id,c.generation).run();
   throw error instanceof MeliError?error:new MeliError(502,message);
  }
 }
}
