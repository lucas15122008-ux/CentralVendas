import {z} from 'zod';
import {remoteId} from './protocol.ts';
import {randomToken} from './crypto.ts';
import {MeliError,MeliService} from './service.ts';
export const notificationSchema=z.object({application_id:remoteId,user_id:remoteId,topic:z.enum(['orders_v2','shipments']),resource:z.string().max(100)}).refine(v=>new RegExp('^/'+(v.topic==='orders_v2'?'orders':'shipments')+'/[0-9]{1,30}$').test(v.resource));
type Job={id:string;owner_id:string;account_id:string;generation:string;resource:string;revision:number;attempts:number;lease:string};
export class MeliJobs{
 service:MeliService;
 constructor(service:MeliService){this.service=service;}
 async enqueueNotification(input:unknown){
  const parsed=notificationSchema.safeParse(input);if(!parsed.success)throw new MeliError(400,'Aviso inválido.');const n=parsed.data,{db,now}=this.service;
  const connection=await db.prepare("SELECT c.account_id,c.owner_id,c.generation FROM meli_connections c JOIN meli_apps a ON a.owner_id=c.owner_id WHERE a.client_id=? AND c.seller_id=? AND c.status IN ('connected','refreshing')").bind(n.application_id,n.user_id).first<{account_id:string;owner_id:string;generation:string}>();
  if(!connection)return false;
  const id=connection.account_id+':'+connection.generation+':'+n.resource;
  await db.prepare("INSERT INTO meli_jobs(id,owner_id,account_id,generation,resource,due_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=revision+1,due_at=MIN(due_at,excluded.due_at),attempts=0,error=NULL,updated_at=excluded.updated_at").bind(id,connection.owner_id,connection.account_id,connection.generation,n.resource,now(),now()).run();
  await db.prepare("INSERT INTO meli_automation_health(id,heartbeat_at,event_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET event_at=excluded.event_at").bind('events:'+connection.owner_id,now(),now()).run();return true;
 }
 async recover(){
  const {db,now}=this.service;
  await db.prepare("INSERT INTO meli_automation_health(id,heartbeat_at) VALUES('bridge',?) ON CONFLICT(id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at").bind(now()).run();
  await db.prepare("INSERT OR IGNORE INTO meli_jobs(id,owner_id,account_id,generation,resource,due_at,updated_at) SELECT account_id||':'||generation||':sync',owner_id,account_id,generation,'sync',?,? FROM meli_connections WHERE status IN ('connected','refreshing')").bind(now(),now()).run();
  await db.prepare("INSERT OR IGNORE INTO meli_jobs(id,owner_id,account_id,generation,resource,due_at,updated_at) SELECT account_id||':'||generation||':catalog',owner_id,account_id,generation,'catalog',?,? FROM meli_connections WHERE status IN ('connected','refreshing')").bind(now(),now()).run();
 }
 async processNext(){
  const {db,now}=this.service;
  await db.prepare("DELETE FROM meli_jobs WHERE NOT EXISTS(SELECT 1 FROM meli_connections c WHERE c.account_id=meli_jobs.account_id AND c.owner_id=meli_jobs.owner_id AND c.generation=meli_jobs.generation AND c.status IN ('connected','refreshing'))").run();
  const lease=randomToken();
  const job=await db.prepare("UPDATE meli_jobs SET lease=?,lease_until=? WHERE id=(SELECT j.id FROM meli_jobs j WHERE due_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY CASE WHEN resource='sync' THEN 1 ELSE 0 END,due_at,id LIMIT 1) AND (lease_until IS NULL OR lease_until<=?) RETURNING *").bind(lease,now()+90000,now(),now(),now()).first<Job>();
  if(!job)return {pending:false};
  try{
   let more=false;
   if(job.resource==='sync'){const result=await this.service.sync(job.owner_id,job.account_id,'auto',job.generation);more=result.status!=='complete'||result.needsMore;}
   else if(job.resource==='catalog'){const result=await this.service.syncCatalog(job.owner_id,job.account_id,job.generation);more=result.status!=='complete';}
   else await this.service.processResource(job.owner_id,job.account_id,job.generation,job.resource);
   if(!more)await db.prepare('DELETE FROM meli_jobs WHERE id=? AND revision=? AND lease=?').bind(job.id,job.revision,lease).run();
   await db.prepare('UPDATE meli_jobs SET lease=NULL,lease_until=NULL,due_at=?,error=NULL,attempts=0 WHERE id=? AND lease=?').bind(now(),job.id,lease).run();
  }catch(error){
   if(error instanceof MeliError&&error.status===401)await db.prepare("UPDATE meli_connections SET status='reconnect',tokens=NULL WHERE account_id=? AND owner_id=? AND generation=?").bind(job.account_id,job.owner_id,job.generation).run();
   const message=error instanceof MeliError?error.message:'A atualização será retomada automaticamente.';
   const delay=Math.min(3600000,30000*2**Math.min(job.attempts,7));
   await db.prepare('UPDATE meli_jobs SET attempts=CASE WHEN revision=? THEN attempts+1 ELSE attempts END,due_at=CASE WHEN revision=? THEN ? ELSE due_at END,error=CASE WHEN revision=? THEN ? ELSE error END,lease=NULL,lease_until=NULL WHERE id=? AND lease=?').bind(job.revision,job.revision,now()+delay,job.revision,message,job.id,lease).run();
  }
  const ready=await db.prepare('SELECT id FROM meli_jobs WHERE due_at<=? AND (lease_until IS NULL OR lease_until<=?) LIMIT 1').bind(now(),now()).first();return {pending:!!ready};
 }
}
