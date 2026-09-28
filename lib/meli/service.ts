import {z} from 'zod';
import {accountLease,type WriteGuard} from './lease.ts';
import {randomToken,seal,unseal,pkceChallenge} from './crypto.ts';
import {authorizationUrl,remoteId,orderSchema,normalizeOrders,type MeliOrder,type ShipmentCost} from './protocol.ts';
import {hasNoPromotionEvidence,parseSellerDiscounts,type SellerDiscountSummary} from './discounts.ts';
import {parseCatalogPage} from './catalog.ts';
import {ADS_METRICS,ADS_PAGE_LIMIT,mergeAdRows,parseAdsPage,parseAdvertiser,pendingAdsDays,type AdSpendRow} from './ads.ts';
export const CALLBACK_URL='https://central-vendas-lucas.kisashi.chatgpt.site/api/meli/callback';
export const CATALOG_REFRESH_MS=3600000;
export class MeliError extends Error {status:number;upstreamStatus:number|null;code:string|null;constructor(status:number,message:string,upstreamStatus:number|null=null,code:string|null=null){super(message);this.status=status;this.upstreamStatus=upstreamStatus;this.code=code;}}
const configSchema=z.object({clientId:z.string().trim().regex(/^\d{3,30}$/),clientSecret:z.string().trim().min(8).max(500),pkce:z.boolean()});
const tokenSchema=z.object({access_token:z.string().min(1).max(10000),refresh_token:z.string().min(1).max(10000),expires_in:z.number().int().positive().max(86400*365),user_id:remoteId});
type App={owner_id:string;client_id:string;secret:string;pkce:number;revision:string};
type Connection={account_id:string;owner_id:string;seller_id:string|null;nickname:string|null;status:string;generation:string;tokens:string|null;expires_at:number|null;refresh_started:number|null;sync_cursor:string|null;gross_sales_version:number;logistics_version:number;financials_version:number};
type Flow={account_id:string;generation:string;app_revision:string;verifier:string};
type Run={id:string;account_id:string;owner_id:string;generation:string;mode:'history'|'incremental';from_date:string;to_date:string;offset:number;total:number|null;status:string;lease:string|null;lease_until:number|null;error:string|null;updated_at:number};
type CatalogRun={id:string;account_id:string;owner_id:string;generation:string;offset:number;total:number|null;scroll_id:string|null;status:string;lease:string|null;lease_until:number|null;error:string|null;updated_at:number};
export type AdsState='active'|'no_advertiser'|'forbidden'|'error';
type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
const shipmentDetailSchema=z.object({id:remoteId,logistic:z.object({type:z.string().min(1).max(80).nullish()}).nullish(),logistic_type:z.string().min(1).max(80).nullish()});
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export class MeliService {
 db:D1Database;key:string;fetcher:Fetcher;now:()=>number;
 // Calling native Worker fetch as this.fetcher changes its receiver and throws Illegal invocation.
 constructor(db:D1Database,key:string,fetcher:Fetcher=(url,init)=>fetch(url,init),now:()=>number=Date.now){this.db=db;this.key=key;this.fetcher=fetcher;this.now=now;}
 async account(owner:string,id:string){const row=await this.db.prepare('SELECT id FROM accounts WHERE id=? AND owner_id=?').bind(id,owner).first();if(!row)throw new MeliError(404,'Conta não encontrada.');}
 async app(owner:string){if(!this.key)throw new MeliError(503,'A proteção da conexão ainda não foi configurada.');const app=await this.db.prepare('SELECT * FROM meli_apps WHERE owner_id=?').bind(owner).first<App>();if(!app)throw new MeliError(409,'Configure sua aplicação antes de conectar.');return app;}
 async connection(owner:string,id:string){await this.account(owner,id);const row=await this.db.prepare('SELECT * FROM meli_connections WHERE owner_id=? AND account_id=?').bind(owner,id).first<Connection>();if(!row)throw new MeliError(409,'Autorize esta conta no Mercado Livre.');return row;}
 async status(owner:string,automationConfigured=false){
  const app=await this.db.prepare('SELECT client_id,pkce FROM meli_apps WHERE owner_id=?').bind(owner).first<{client_id:string;pkce:number}>();
  const connections=await this.db.prepare('SELECT c.account_id AS accountId,c.seller_id AS sellerId,c.nickname,c.status,c.updated_at AS updatedAt,c.synced_at AS syncedAt,r.status AS syncStatus,r.mode AS syncMode,r.needs_more AS needsMore,r.offset AS processed,r.total,r.error,r.from_date AS fromDate,r.to_date AS toDate FROM meli_connections c LEFT JOIN meli_sync_runs r ON r.account_id=c.account_id AND r.owner_id=c.owner_id AND r.generation=c.generation WHERE c.owner_id=?').bind(owner).all<{accountId:string;sellerId:string|null;nickname:string|null;status:string;updatedAt:number;syncedAt:number|null;syncStatus:string|null;syncMode:'history'|'incremental'|null;needsMore:number|null;processed:number|null;total:number|null;error:string|null;fromDate:string|null;toDate:string|null}>();
  const health=await this.db.prepare("SELECT heartbeat_at FROM meli_automation_health WHERE id='bridge'").first<{heartbeat_at:number}>();
  const queue=await this.db.prepare('SELECT COUNT(*) AS pending,MIN(error) AS error FROM meli_jobs WHERE owner_id=?').bind(owner).first<{pending:number;error:string|null}>();
  const event=await this.db.prepare('SELECT event_at FROM meli_automation_health WHERE id=?').bind('events:'+owner).first<{event_at:number}>();
  const heartbeatAt=health?.heartbeat_at??null;
  const automation={state:!automationConfigured||!heartbeatAt?'pending':this.now()-heartbeatAt>180000?'lagging':queue?.error?'retrying':'active',heartbeatAt,lastEventAt:event?.event_at??null,pending:queue?.pending??0,error:queue?.error??null};
  return {automation,app:{configured:!!app,secureReady:!!this.key,clientId:app?.client_id??'',pkce:!!app?.pkce,callbackUrl:CALLBACK_URL},connections:connections.results.map(c=>({...c,needsMore:!!c.needsMore}))};
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
   this.db.prepare("INSERT INTO meli_connections(account_id,owner_id,status,generation,updated_at) SELECT ?,?,'authorizing',?,? WHERE EXISTS(SELECT 1 FROM meli_apps WHERE owner_id=? AND revision=?) ON CONFLICT(account_id) DO UPDATE SET status='authorizing',generation=excluded.generation,tokens=NULL,expires_at=NULL,refresh_started=NULL,sync_cursor=NULL,updated_at=excluded.updated_at RETURNING account_id").bind(id,owner,generation,this.now(),owner,app.revision),
   this.db.prepare('INSERT INTO meli_oauth_states(state_hash,owner_id,account_id,browser_hash,verifier,generation,app_revision,expires_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM meli_connections WHERE account_id=? AND owner_id=? AND generation=?)').bind(stateHash,owner,id,await hash(browser),encrypted,generation,app.revision,this.now()+600000,id,owner,generation)
  ]);
  if(!results[1].results.length)throw new MeliError(409,'A configuração mudou. Inicie a conexão novamente.');
  return {url:authorizationUrl({clientId:app.client_id,redirectUri:CALLBACK_URL,pkce:!!app.pkce},state,await pkceChallenge(verifier)),state,browser};
 }
 async remote(path:string,token?:string,body?:URLSearchParams,extraHeaders:Record<string,string>={}){
  // Workers supports manual/follow only. Manual redirects reach the non-2xx rejection below;
  // credentials are never forwarded to the Location target.
  let response:Response;
  try{response=await this.fetcher('https://api.mercadolibre.com'+path,{method:body?'POST':'GET',redirect:'manual',signal:AbortSignal.timeout(12000),headers:{Accept:'application/json',...(!path.startsWith('/items/bulk?')&&!path.startsWith('/advertising/')?{'x-format-new':'true'}:{}),...extraHeaders,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(body?{body:body.toString()}:{})});}catch{throw new MeliError(502,'O Mercado Livre não respondeu. Tente retomar a atualização.');}
  if(!response.ok){
   const status=response.status;
   // Free-form errors can echo credentials or query values. Log only known error identifiers.
   const knownCodes=new Set(['bad_request','invalid_limit','invalid_token','invalid_grant','invalid_client','invalid_request','unauthorized','forbidden','not_found','discount_not_found','advertiser_not_found','too_many_requests','internal_server_error']);
   let detail:Record<string,unknown>={};
   try{const data=await response.json();if(data&&typeof data==='object'&&!Array.isArray(data))detail=data as Record<string,unknown>;}catch{/* Non-JSON responses are identified by resource and status only. */}
   const code=typeof detail.error==='string'&&knownCodes.has(detail.error)?detail.error:'unrecognized_error';
   console.error('meli_upstream_error',{resource:path.split('?')[0].replace(/\/\d+(?=\/|$)/g,'/:id'),status,code});
   throw new MeliError(status===401?401:status===403?403:status===404?404:status===429?429:502,status===401?'A autorização expirou. Reconecte esta conta.':status===403?'A aplicação não tem acesso a este recurso. Confira as permissões no Mercado Livre.':status===429?'O Mercado Livre pediu uma pausa. Retome a atualização em alguns minutos.':'Não foi possível consultar este recurso no Mercado Livre.',status,code);
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
 async enrich(id:string,seller:string,orders:Map<string,MeliOrder>,get:(path:string)=>Promise<unknown>){
   const shipments:ShipmentCost[]=[];
   for(const shipmentId of new Set([...orders.values()].map(o=>o.shipping?.id).filter((s):s is string=>!!s))){
    const shipment:ShipmentCost={id:shipmentId,sellerCostCents:null,orderIds:[],complete:false,logisticType:null};shipments.push(shipment);
    try{
     const parsed=shipmentDetailSchema.safeParse(await get('/shipments/'+shipmentId));
     if(!parsed.success||parsed.data.id!==shipmentId)throw new MeliError(502,'Não foi possível confirmar o envio.');
     shipment.logisticType=parsed.data.logistic?.type??parsed.data.logistic_type??null;
    }catch(error){if(!(error instanceof MeliError)||![403,404].includes(error.status))throw error;/* The sale remains usable while logistics stays unknown. */}
    try{
     const items=z.array(z.object({order_id:remoteId,sender_id:remoteId,item_id:z.string(),variation_id:remoteId.nullish(),quantity:z.number().positive()})).min(1).max(50).parse(await get('/shipments/'+shipmentId+'/items'));
     if(items.some(i=>i.sender_id!==seller))continue;
     shipment.orderIds=[...new Set(items.map(i=>i.order_id))];
     if(shipment.orderIds.length>15||orders.size+shipment.orderIds.filter(orderId=>!orders.has(orderId)).length>20)continue;
     for(const orderId of shipment.orderIds){if(!orders.has(orderId)){const extra=orderSchema.parse(await get('/orders/'+orderId));if(extra.id!==orderId||extra.seller.id!==seller||extra.shipping?.id!==shipmentId)throw new MeliError(502,'Os pedidos de um envio não puderam ser confirmados.');orders.set(extra.id,extra);}}
     const expected=new Map<string,number>(),actual=new Map<string,number>();
     for(const orderId of shipment.orderIds)for(const line of orders.get(orderId)!.order_items){const key=JSON.stringify([orderId,line.item.id,line.item.variation_id??'0']);expected.set(key,(expected.get(key)??0)+line.quantity);}
     for(const item of items){const key=JSON.stringify([item.order_id,item.item_id,item.variation_id??'0']);actual.set(key,(actual.get(key)??0)+item.quantity);}
     if(expected.size!==actual.size||[...expected].some(([key,quantity])=>actual.get(key)!==quantity))continue;
     const costs=z.object({senders:z.array(z.object({user_id:remoteId,cost:z.number().finite().nonnegative().max(1e9)}))}).parse(await get('/shipments/'+shipmentId+'/costs'));
     const sender=costs.senders.filter(s=>s.user_id===seller);if(sender.length===1)shipment.sellerCostCents=Math.round(sender[0].cost*100);shipment.complete=true;
    }catch(error){if(error instanceof MeliError&&![403,404].includes(error.status))throw error;/* Unknown shipment data remains pending, never zero. */}
   }
   const discountState=new Map<string,SellerDiscountSummary|null>();
   for(const order of orders.values()){
    try{discountState.set(order.id,parseSellerDiscounts(order,await get('/orders/'+order.id+'/discounts')));}
    catch(error){
     if(error instanceof MeliError&&![403,404].includes(error.status))throw error;
     const noDiscount=error instanceof MeliError&&error.upstreamStatus===404&&error.code==='discount_not_found'&&hasNoPromotionEvidence(order);
     discountState.set(order.id,noDiscount?{sellerCentsByLine:order.order_items.map(()=>0),hasDiscounts:false}:null);
    }
   }
   return normalizeOrders(id,seller,[...orders.values()],shipments,discountState);
 }
 async sync(owner:string,id:string,mode:'auto'|'history'='auto',expectedGeneration?:string){
  const c=await this.connection(owner,id);
  if(expectedGeneration&&c.generation!==expectedGeneration)throw new MeliError(409,'A conexão mudou.');
  try{return await accountLease(this.db,owner,id,c.generation,this.now,async guard=>{
   if(c.gross_sales_version<2){
    const reset=await this.db.prepare(`UPDATE meli_connections SET gross_sales_version=2,sync_cursor=NULL WHERE account_id=? AND owner_id=? AND generation=? AND gross_sales_version<2 AND ${guard.sql} RETURNING account_id`).bind(id,owner,c.generation,...guard.values()).first();
    if(!reset)throw new MeliError(409,'A conexão mudou antes da releitura do faturamento. Tente novamente.');
    await this.db.prepare("UPDATE meli_sync_runs SET status='complete',needs_more=1,lease=NULL,lease_until=NULL,error=NULL WHERE account_id=? AND owner_id=? AND generation=?").bind(id,owner,c.generation).run();
   }
   if(c.logistics_version<2){
    const reset=await this.db.prepare(`UPDATE meli_connections SET logistics_version=2,sync_cursor=NULL WHERE account_id=? AND owner_id=? AND generation=? AND logistics_version<2 AND ${guard.sql} RETURNING account_id`).bind(id,owner,c.generation,...guard.values()).first();
    if(!reset)throw new MeliError(409,'A conexão mudou antes da releitura logística. Tente novamente.');
    await this.db.prepare("UPDATE meli_sync_runs SET status='complete',needs_more=1,lease=NULL,lease_until=NULL,error=NULL WHERE account_id=? AND owner_id=? AND generation=?").bind(id,owner,c.generation).run();
   }
   if(c.financials_version<4){
    const reset=await this.db.prepare(`UPDATE meli_connections SET financials_version=4,sync_cursor=NULL WHERE account_id=? AND owner_id=? AND generation=? AND financials_version<4 AND ${guard.sql} RETURNING account_id`).bind(id,owner,c.generation,...guard.values()).first();
    if(!reset)throw new MeliError(409,'A conexão mudou antes da releitura financeira. Tente novamente.');
    await this.db.prepare("UPDATE meli_sync_runs SET status='complete',needs_more=1,lease=NULL,lease_until=NULL,error=NULL WHERE account_id=? AND owner_id=? AND generation=?").bind(id,owner,c.generation).run();
   }
   return this.syncBatch(owner,id,mode,guard);
  });}
  catch(error){if(error instanceof Error&&error.message==='account_busy')throw new MeliError(409,'Esta conta já está atualizando. Aguarde a conclusão do lote.');throw error;}
 }
 async saveResource(owner:string,id:string,orders:Map<string,MeliOrder>,rows:ReturnType<typeof normalizeOrders>,guard:WriteGuard){
  const statements=[...orders.values()].map(order=>{const lines=rows.filter(r=>r.orderId===order.id);return this.db.prepare(`INSERT INTO meli_orders(id,owner_id,account_id,order_id,date,data,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql} ON CONFLICT(account_id,order_id) DO UPDATE SET date=excluded.date,data=excluded.data,updated_at=excluded.updated_at RETURNING id`).bind(id+':'+order.id,owner,id,order.id,lines[0].date,JSON.stringify(lines),this.now(),...guard.values())});
  if(!statements.length)return;
  const saved=await this.db.batch(statements);if(saved.some(r=>!r.results.length))throw new MeliError(409,'A conexão mudou durante a atualização.');
 }
 async syncCatalog(owner:string,id:string,expectedGeneration?:string):Promise<{status:'running'|'complete';processed:number;total:number}>{
  const c=await this.connection(owner,id);
  if(expectedGeneration&&c.generation!==expectedGeneration)throw new MeliError(409,'A conexão mudou.');
  try{return await accountLease(this.db,owner,id,c.generation,this.now,guard=>this.syncCatalogBatch(owner,id,guard));}
  catch(error){if(error instanceof Error&&error.message==='account_busy')throw new MeliError(409,'Esta conta já está atualizando. Aguarde a conclusão do lote.');throw error;}
 }
 private async syncCatalogBatch(owner:string,id:string,accountGuard:WriteGuard):Promise<{status:'running'|'complete';processed:number;total:number}>{
  const token=await this.accessToken(owner,id),c=await this.connection(owner,id);
  if(!c.seller_id)throw new MeliError(409,'Autorize o vendedor.');
  const now=this.now(),runId=randomToken(),lease=randomToken();
  await this.db.prepare("INSERT INTO meli_catalog_runs(account_id,owner_id,generation,id,offset,status,updated_at) VALUES(?,?,?,?,0,'running',?) ON CONFLICT(account_id) DO UPDATE SET owner_id=excluded.owner_id,generation=excluded.generation,id=excluded.id,offset=0,total=NULL,scroll_id=NULL,status='running',lease=NULL,lease_until=NULL,error=NULL,updated_at=excluded.updated_at WHERE meli_catalog_runs.status='complete' OR meli_catalog_runs.generation<>excluded.generation")
   .bind(id,owner,c.generation,runId,now).run();
  // Runs created before scan pagination have an offset but no cursor. Restart them once;
  // saved listings remain visible and are replaced atomically as the new scan completes.
  await this.db.prepare("UPDATE meli_catalog_runs SET id=?,offset=0,total=NULL,scroll_id=NULL,status='running',lease=NULL,lease_until=NULL,error=NULL,updated_at=? WHERE account_id=? AND owner_id=? AND generation=? AND status<>'complete' AND offset>0 AND scroll_id IS NULL")
   .bind(runId,now,id,owner,c.generation).run();
  const run=await this.db.prepare("UPDATE meli_catalog_runs SET lease=?,lease_until=?,status='running',error=NULL,updated_at=? WHERE account_id=? AND owner_id=? AND generation=? AND (lease_until IS NULL OR lease_until<?) RETURNING *")
   .bind(lease,now+90000,now,id,owner,c.generation,now).first<CatalogRun>();
  if(!run)throw new MeliError(409,'O catálogo já está atualizando em outra aba.');
  const guard="EXISTS(SELECT 1 FROM meli_catalog_runs r JOIN meli_connections c ON c.account_id=r.account_id AND c.owner_id=r.owner_id WHERE r.account_id=? AND r.owner_id=? AND r.id=? AND r.lease=? AND r.generation=c.generation AND c.status='connected' AND r.lease_until>?) AND "+accountGuard.sql;
  const guardValues=()=>[id,owner,run.id,lease,this.now(),...accountGuard.values()];
  try{
   const query=new URLSearchParams({limit:'100',search_type:'scan',...(run.scroll_id?{scroll_id:run.scroll_id}:{})});
   const search=await this.remote('/users/'+c.seller_id+'/items/search?'+query,token);
   const parsedSearch=z.object({seller_id:remoteId,paging:z.object({total:z.number().int().nonnegative(),limit:z.number().int().positive()}).passthrough().optional(),scroll_id:z.string().min(1).max(10000).nullable().optional(),results:z.array(z.string().min(1).max(100)).max(100).nullable()}).safeParse(search);
   if(!parsedSearch.success||parsedSearch.data.seller_id!==c.seller_id)throw new MeliError(502,'O Mercado Livre retornou um catálogo incompleto.');
   const reportedTotal=parsedSearch.data.paging?.total;
   if(run.total!==null&&reportedTotal!==undefined&&reportedTotal!==run.total)throw new MeliError(502,'A lista de anúncios mudou durante a leitura.');
   const total=run.total??reportedTotal;
   if(total===undefined)throw new MeliError(502,'O Mercado Livre não informou o total de anúncios.');
   const results=parsedSearch.data.results??[];
   const ended=parsedSearch.data.results===null;
   if(!ended&&!results.length&&run.offset<total)throw new MeliError(502,'A lista de anúncios mudou durante a leitura.');
   const nextScroll=parsedSearch.data.scroll_id??run.scroll_id;
   if(!ended&&run.offset+results.length<total&&!nextScroll)throw new MeliError(502,'O Mercado Livre não informou a continuação do catálogo.');
   const listings:ReturnType<typeof parseCatalogPage>=[];
   for(let start=0;start<results.length;start+=20){
    const chunk=results.slice(start,start+20);
    const items=await this.remote('/items/bulk?'+new URLSearchParams({ids:chunk.join(','),attributes:'body.id,body.seller_id,body.title,body.status,body.last_updated,body.seller_custom_field,body.attributes,body.variations'}),token);
    try{listings.push(...parseCatalogPage({seller_id:parsedSearch.data.seller_id,paging:{total,offset:run.offset+start,limit:chunk.length},results:chunk},items,id));}catch(error){
     const first=Array.isArray(items)&&items[0]&&typeof items[0]==='object'&&!Array.isArray(items[0])?items[0] as Record<string,unknown>:null;
     const body=first?.body&&typeof first.body==='object'&&!Array.isArray(first.body)?first.body as Record<string,unknown>:null;
     const safeKeys=(value:Record<string,unknown>|null)=>value?Object.keys(value).filter(key=>/^[a-z_]{1,40}$/i.test(key)).slice(0,20):[];
     const reason=error instanceof z.ZodError
      ?error.issues.slice(0,5).map(issue=>({path:issue.path.join('.'),code:issue.code}))
      :error instanceof Error?error.message:'unknown';
     console.error('meli_catalog_parse_error',{reason,entryKeys:safeKeys(first),bodyKeys:safeKeys(body)});
     throw new MeliError(502,'O Mercado Livre retornou anúncios incompletos.');
    }
   }
   const listingStatements=listings.map(listing=>this.db.prepare(`INSERT INTO meli_listings(id,owner_id,account_id,item_id,variation_id,title,status,seller_sku,seen_generation,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard}
    ON CONFLICT(owner_id,account_id,item_id,variation_id) DO UPDATE SET title=excluded.title,status=excluded.status,seller_sku=excluded.seller_sku,seen_generation=excluded.seen_generation,updated_at=excluded.updated_at`)
    .bind(listing.id,owner,id,listing.itemId,listing.variationId??'',listing.title,listing.status,listing.sellerSku,run.id,listing.updatedAt,...guardValues()));
   for(let start=0;start<listingStatements.length;start+=50)await this.db.batch(listingStatements.slice(start,start+50));
   const offset=run.offset+results.length,status:CatalogRun['status']=ended||offset>=total?'complete':'running';
   const statements=[];
   if(status==='complete')statements.push(this.db.prepare(`UPDATE meli_listings SET status='inactive',updated_at=? WHERE owner_id=? AND account_id=? AND seen_generation<>? AND ${guard}`).bind(this.now(),owner,id,run.id,...guardValues()));
   statements.push(this.db.prepare(`UPDATE meli_catalog_runs SET offset=?,total=?,scroll_id=?,status=?,lease=NULL,lease_until=NULL,error=NULL,updated_at=? WHERE account_id=? AND owner_id=? AND ${guard} RETURNING account_id`).bind(offset,total,status==='complete'?null:nextScroll,status,this.now(),id,owner,...guardValues()));
   const saved=await this.db.batch(statements);
   if(!saved.at(-1)?.results.length)throw new MeliError(409,'A atualização do catálogo foi cancelada ou substituída.');
   return {status:status as 'running'|'complete',processed:offset,total};
  }catch(error){
   const message=error instanceof MeliError?error.message:'O catálogo contém dados incompletos. A atualização será retomada.';
   if(error instanceof MeliError&&error.upstreamStatus===400&&run.scroll_id){
    await this.db.prepare("UPDATE meli_catalog_runs SET id=?,offset=0,total=NULL,scroll_id=NULL,status='paused',error=?,lease=NULL,lease_until=NULL,updated_at=? WHERE owner_id=? AND account_id=? AND id=? AND lease=?").bind(randomToken(),message,this.now(),owner,id,run.id,lease).run();
   }else{
    await this.db.prepare("UPDATE meli_catalog_runs SET status='paused',error=?,lease=NULL,lease_until=NULL,updated_at=? WHERE owner_id=? AND account_id=? AND id=? AND lease=?").bind(message,this.now(),owner,id,run.id,lease).run();
   }
   throw error instanceof MeliError?error:new MeliError(502,message);
  }
 }
 async syncAds(owner:string,id:string,expectedGeneration?:string):Promise<{status:'running'|'complete';state:AdsState;processed:number;total:number}>{
  const c=await this.connection(owner,id);
  if(expectedGeneration&&c.generation!==expectedGeneration)throw new MeliError(409,'A conexão mudou.');
  try{return await accountLease(this.db,owner,id,c.generation,this.now,guard=>this.syncAdsBatch(owner,id,guard));}
  catch(error){if(error instanceof Error&&error.message==='account_busy')throw new MeliError(409,'Esta conta já está atualizando. Aguarde a conclusão do lote.');throw error;}
 }
 private async syncAdsBatch(owner:string,id:string,guard:WriteGuard):Promise<{status:'running'|'complete';state:AdsState;processed:number;total:number}>{
  const token=await this.accessToken(owner,id),c=await this.connection(owner,id),started=this.now();
  if(!c.seller_id)throw new MeliError(409,'Autorize o vendedor.');
  const saveState=async(state:AdsState,advertiserId:string|null,error:string|null)=>{
   await this.db.prepare(`INSERT INTO meli_ads_state(account_id,owner_id,generation,advertiser_id,state,error,checked_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ${guard.sql} ON CONFLICT(account_id) DO UPDATE SET owner_id=excluded.owner_id,generation=excluded.generation,advertiser_id=excluded.advertiser_id,state=excluded.state,error=excluded.error,checked_at=excluded.checked_at,updated_at=excluded.updated_at`).bind(id,owner,c.generation,advertiserId,state,error,this.now(),this.now(),...guard.values()).run();
  };
  let saved=await this.db.prepare('SELECT generation,advertiser_id,state,checked_at FROM meli_ads_state WHERE account_id=? AND owner_id=?').bind(id,owner).first<{generation:string;advertiser_id:string|null;state:AdsState;checked_at:number}>();
  // Sellers without Mercado Ads, or apps without the advertising scope, are checked again a few times a day.
  if(!saved||saved.generation!==c.generation||!saved.advertiser_id&&saved.checked_at<this.now()-6*3600000){
   let advertiserId:string|null=null,state:AdsState='active',message:string|null=null;
   try{
    advertiserId=parseAdvertiser(await this.remote('/advertising/advertisers?product_id=PADS',token,undefined,{'Api-Version':'1'}));
    if(!advertiserId)state='no_advertiser';
   }catch(error){
    if(error instanceof MeliError&&error.status===404){state='no_advertiser';}
    else if(error instanceof MeliError&&error.status===403){state='forbidden';message='A aplicação não tem acesso à Publicidade. Ative a permissão de Publicidade no portal do Mercado Livre e reconecte a conta.';}
    else if(error instanceof z.ZodError){console.error('meli_ads_parse_error',{resource:'advertisers',issues:error.issues.slice(0,5).map(issue=>({path:issue.path.join('.'),code:issue.code}))});throw new MeliError(502,'O Mercado Livre retornou dados de publicidade incompletos.');}
    else throw error;
   }
   await saveState(state,advertiserId,message);
   saved={generation:c.generation,advertiser_id:advertiserId,state,checked_at:this.now()};
  }
  if(!saved.advertiser_id)return {status:'complete',state:saved.state,processed:0,total:0};
  const days=await this.db.prepare('SELECT date,fetched_at AS fetchedAt FROM meli_ads_days WHERE account_id=? AND owner_id=?').bind(id,owner).all<{date:string;fetchedAt:number}>();
  const pending=pendingAdsDays(days.results,this.now());
  let processed=0;
  try{
   for(const date of pending){
    if(this.now()>started+45000)break;
    const rows:AdSpendRow[]=[];
    for(let offset=0,total=Infinity;offset<total;offset+=ADS_PAGE_LIMIT){
     if(offset>=5000)throw new MeliError(502,'Mais de 5.000 anúncios em publicidade em um dia: leitura interrompida.');
     const query=new URLSearchParams({limit:String(ADS_PAGE_LIMIT),offset:String(offset),date_from:date,date_to:date,metrics:ADS_METRICS});
     let page;
     try{page=parseAdsPage(await this.remote('/advertising/MLB/advertisers/'+saved.advertiser_id+'/product_ads/ads/search?'+query,token,undefined,{'Api-Version':'2'}));}
     catch(error){
      if(error instanceof z.ZodError){console.error('meli_ads_parse_error',{resource:'ads_search',issues:error.issues.slice(0,5).map(issue=>({path:issue.path.join('.'),code:issue.code}))});throw new MeliError(502,'O Mercado Livre retornou dados de publicidade incompletos.');}
      throw error;
     }
     rows.push(...page.rows);total=page.total;
     if(!page.rows.length)break;
    }
    const statements=[
     this.db.prepare(`DELETE FROM meli_ad_spend WHERE account_id=? AND owner_id=? AND date=? AND ${guard.sql}`).bind(id,owner,date,...guard.values()),
     ...mergeAdRows(rows).map(row=>this.db.prepare(`INSERT INTO meli_ad_spend(id,owner_id,account_id,item_id,date,cost_cents,clicks,prints,attributed_cents,attributed_units,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql}`).bind(id+':'+row.itemId+':'+date,owner,id,row.itemId,date,row.costCents,row.clicks,row.prints,row.attributedCents,row.attributedUnits,this.now(),...guard.values())),
     this.db.prepare(`INSERT INTO meli_ads_days(account_id,owner_id,date,fetched_at) SELECT ?,?,?,? WHERE ${guard.sql} ON CONFLICT(account_id,date) DO UPDATE SET fetched_at=excluded.fetched_at RETURNING date`).bind(id,owner,date,this.now(),...guard.values()),
    ];
    const result=await this.db.batch(statements);
    if(!result.at(-1)?.results.length)throw new MeliError(409,'A conexão mudou durante a leitura da publicidade.');
    processed++;
   }
  }catch(error){
   if(error instanceof MeliError&&error.status===403){await saveState('forbidden',null,'A aplicação não tem acesso à Publicidade. Ative a permissão de Publicidade no portal do Mercado Livre e reconecte a conta.');return {status:'complete',state:'forbidden',processed,total:pending.length};}
   await saveState('error',saved.advertiser_id,error instanceof MeliError?error.message:'Não foi possível ler a publicidade.');
   throw error;
  }
  if(saved.state!=='active')await saveState('active',saved.advertiser_id,null);
  return {status:processed<pending.length?'running':'complete',state:'active',processed,total:pending.length};
 }
 async processResource(owner:string,id:string,generation:string,resource:string){
  if(!/^\/(orders|shipments)\/\d{1,30}$/.test(resource))throw new MeliError(400,'Recurso inválido.');
  return accountLease(this.db,owner,id,generation,this.now,async guard=>{
   const token=await this.accessToken(owner,id),c=await this.connection(owner,id),started=this.now();
   if(c.generation!==generation||!c.seller_id)throw new MeliError(409,'A conexão mudou.');
   const get=async(path:string)=>{if(this.now()>started+60000)throw new MeliError(503,'O processamento será retomado.');return this.remote(path,token)};
   const orders=new Map<string,MeliOrder>();
   const add=async(path:string)=>{const order=orderSchema.parse(await get(path));if(order.seller.id!==c.seller_id||path!=='/orders/'+order.id)throw new MeliError(502,'Não foi possível confirmar o pedido.');orders.set(order.id,order)};
   if(resource.startsWith('/orders/'))await add(resource);
   else{
    const items=z.array(z.object({order_id:remoteId,sender_id:remoteId})).min(1).max(50).parse(await get(resource+'/items'));
    if(items.some(i=>i.sender_id!==c.seller_id))throw new MeliError(502,'Não foi possível confirmar o envio.');
    const ids=[...new Set(items.map(i=>i.order_id))];if(ids.length>15)throw new MeliError(502,'Envio acima do limite de conferência.');
    for(const orderId of ids){await add('/orders/'+orderId);if(orders.get(orderId)?.shipping?.id!==resource.split('/')[2])throw new MeliError(502,'Envio inconsistente.');}
   }
   await this.saveResource(owner,id,orders,normalizeOrders(id,c.seller_id,[...orders.values()],[],new Map([...orders.keys()].map(key=>[key,null]))),guard);
   const rows=await this.enrich(id,c.seller_id,orders,get);
   await this.saveResource(owner,id,orders,rows,guard);
  });
 }
 private async syncBatch(owner:string,id:string,mode:'auto'|'history',accountGuard:WriteGuard){
  const token=await this.accessToken(owner,id);const c=await this.connection(owner,id);if(!c.seller_id)throw new MeliError(409,'Autorize o vendedor.');
  const now=this.now(),runId=randomToken(),lease=randomToken();
  // Search dates have hourly precision. Overlap one hour and freeze each window until complete.
  const cursor=c.sync_cursor?Date.parse(c.sync_cursor):NaN;
  const desiredMode=mode==='history'||!Number.isFinite(cursor)?'history':'incremental';
  const from=new Date(desiredMode==='history'?now-30*86400000:cursor-3600000);from.setUTCMinutes(0,0,0);
  const to=new Date(desiredMode==='history'?now+3600000:Math.min(now+3600000,from.getTime()+86400000));to.setUTCMinutes(0,0,0);
  await this.db.prepare("INSERT INTO meli_sync_runs(account_id,owner_id,generation,id,mode,from_date,to_date,offset,status,updated_at) VALUES(?,?,?,?,?,?,?,0,'running',?) ON CONFLICT(account_id) DO UPDATE SET generation=excluded.generation,id=excluded.id,mode=excluded.mode,from_date=excluded.from_date,to_date=excluded.to_date,offset=0,total=NULL,needs_more=0,status='running',lease=NULL,lease_until=NULL,error=NULL,updated_at=excluded.updated_at WHERE meli_sync_runs.status='complete' OR meli_sync_runs.generation<>excluded.generation").bind(id,owner,c.generation,runId,desiredMode,from.toISOString(),to.toISOString(),now).run();
  const run=await this.db.prepare("UPDATE meli_sync_runs SET lease=?,lease_until=?,status='running',error=NULL,updated_at=? WHERE account_id=? AND owner_id=? AND generation=? AND (lease_until IS NULL OR lease_until<?) RETURNING *").bind(lease,now+90000,now,id,owner,c.generation,now).first<Run>();
  if(!run)throw new MeliError(409,'Esta conta já está atualizando em outra aba. Aguarde a conclusão do lote.');
  const guard="EXISTS(SELECT 1 FROM meli_sync_runs r JOIN meli_connections c ON c.account_id=r.account_id AND c.owner_id=r.owner_id WHERE r.account_id=? AND r.owner_id=? AND r.id=? AND r.lease=? AND r.generation=c.generation AND c.status='connected' AND r.lease_until>?) AND "+accountGuard.sql;
  const guardValues=()=>[id,owner,run.id,lease,this.now(),...accountGuard.values()];
  const get=async(path:string)=>{if(this.now()>now+60000)throw new MeliError(503,'O lote demorou além do esperado. Retome para tentar novamente.');return this.remote(path,token)};
  try{
   if(run.offset>=10000)throw new MeliError(409,'O limite de 10.000 pedidos desta atualização foi atingido. Os dados estão parciais; é necessário ampliar a sincronização por períodos.');
   // Seller and dates scope the search; no status allowlist can omit cancellations or send unsupported filters.
   const dateField=run.mode==='incremental'?'order.date_last_updated':'order.date_created';
   const query=new URLSearchParams({seller:c.seller_id,sort:'date_asc',limit:'5',offset:String(run.offset),[dateField+'.from']:run.from_date,[dateField+'.to']:run.to_date});
   const search=z.object({results:z.array(orderSchema).max(5),paging:z.object({total:z.number().int().nonnegative(),offset:z.number().int().nonnegative()})}).safeParse(await get('/orders/search?'+query));
   if(!search.success||search.data.paging.offset!==run.offset)throw new MeliError(502,'O Mercado Livre retornou um lote incompleto. Retome a atualização.');
   if(!search.data.results.length&&run.offset<search.data.paging.total)throw new MeliError(502,'A lista de pedidos mudou durante a leitura. Tente retomar.');
   const orders=new Map<string,MeliOrder>();for(const order of search.data.results){if(order.seller.id!==c.seller_id)throw new MeliError(502,'Não foi possível confirmar o vendedor de um pedido.');orders.set(order.id,order);}
   const rows=await this.enrich(id,c.seller_id,orders,get);
   const statements=[];
   // Save every member of each shipment in one D1 transaction, even outside the search page.
   for(const order of orders.values()){
    const lines=rows.filter(r=>r.orderId===order.id);
    statements.push(this.db.prepare(`INSERT INTO meli_orders(id,owner_id,account_id,order_id,date,data,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(account_id,order_id) DO UPDATE SET date=excluded.date,data=excluded.data,updated_at=excluded.updated_at`).bind(id+':'+order.id,owner,id,order.id,lines[0].date,JSON.stringify(lines),this.now(),...guardValues()));
   }
   const offset=run.offset+search.data.results.length,total=search.data.paging.total,status=offset>=total?'complete':'running';
   const needsMore=status==='complete'&&Date.parse(run.to_date)<this.now();
   if(status==='complete')statements.push(this.db.prepare(`UPDATE meli_connections SET synced_at=CASE WHEN ?=1 THEN synced_at ELSE ? END,sync_cursor=CASE WHEN sync_cursor IS NULL OR sync_cursor<? THEN ? ELSE sync_cursor END WHERE account_id=? AND owner_id=? AND ${guard}`).bind(needsMore?1:0,this.now(),run.to_date,run.to_date,id,owner,...guardValues()));
   if(status==='complete')statements.push(this.db.prepare(`INSERT INTO meli_jobs(id,owner_id,account_id,generation,resource,due_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${guard}
    AND NOT EXISTS(SELECT 1 FROM meli_catalog_runs r WHERE r.account_id=? AND r.owner_id=? AND r.generation=? AND r.status='complete' AND r.updated_at>?)
    ON CONFLICT(id) DO UPDATE SET due_at=MIN(meli_jobs.due_at,excluded.due_at),attempts=0,error=NULL,updated_at=excluded.updated_at
    WHERE meli_jobs.owner_id=excluded.owner_id AND meli_jobs.account_id=excluded.account_id AND meli_jobs.generation=excluded.generation AND meli_jobs.resource='catalog' AND meli_jobs.lease IS NULL`).bind(id+':'+c.generation+':catalog',owner,id,c.generation,'catalog',this.now(),this.now(),...guardValues(),id,owner,c.generation,this.now()-CATALOG_REFRESH_MS));
   statements.push(this.db.prepare(`UPDATE meli_sync_runs SET offset=?,total=?,status=?,needs_more=?,lease=NULL,lease_until=NULL,updated_at=? WHERE account_id=? AND owner_id=? AND ${guard} RETURNING *`).bind(offset,total,status,needsMore?1:0,this.now(),id,owner,...guardValues()));
   const saved=await this.db.batch(statements);if(!saved.at(-1)?.results.length)throw new MeliError(409,'A atualização foi cancelada ou substituída. Os dados anteriores foram preservados.');
   return {status,mode:run.mode,needsMore,processed:offset,total,fromDate:run.from_date,toDate:run.to_date};
  }catch(error){
   const message=error instanceof MeliError?error.message:'O lote contém dados incompletos. Retome a atualização.';
   await this.db.prepare("UPDATE meli_sync_runs SET status='paused',error=?,lease=NULL,lease_until=NULL,updated_at=? WHERE owner_id=? AND account_id=? AND id=? AND lease=?").bind(message,this.now(),owner,id,run.id,lease).run();
   if(error instanceof MeliError&&error.status===401)await this.db.prepare("UPDATE meli_connections SET status='reconnect',tokens=NULL WHERE owner_id=? AND account_id=? AND generation=?").bind(owner,id,c.generation).run();
   throw error instanceof MeliError?error:new MeliError(502,message);
  }
 }
}
