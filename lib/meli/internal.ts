import {MeliJobs} from './jobs.ts';
import {MeliService,MeliError} from './service.ts';
import {AUTOMATION_BODY_LIMIT,verifyAutomationRequest} from './automation-auth.ts';
export async function limitedBody(request:Request,limit=AUTOMATION_BODY_LIMIT){
 if(Number(request.headers.get('content-length')??0)>limit)throw new MeliError(413,'Solicitação muito grande.');
 const reader=request.body?.getReader();if(!reader)return '';const chunks:Uint8Array[]=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new MeliError(413,'Solicitação muito grande.');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder().decode(bytes);
}
export async function handleAutomationRequest(request:Request,service:MeliService,secret:string){
 try{
  const body=await limitedBody(request);
  const accepted=await verifyAutomationRequest(request,body,secret,async(nonce,expiresAt)=>{
   await service.db.prepare('DELETE FROM meli_automation_nonces WHERE expires_at<?').bind(Date.now()).run();
   return !!await service.db.prepare('INSERT OR IGNORE INTO meli_automation_nonces(nonce,expires_at) VALUES(?,?) RETURNING nonce').bind(nonce,expiresAt).first();
  });
  if(!accepted)return Response.json({error:'Não autorizado.'},{status:401});
  let data:{action?:unknown;notification?:unknown};try{data=JSON.parse(body);if(!data||typeof data!=='object')throw Error();}catch{return Response.json({error:'Solicitação inválida.'},{status:400});}
  const jobs=new MeliJobs(service);
  if(data.action==='event')return Response.json({accepted:await jobs.enqueueNotification(data.notification),pending:true});
  if(data.action==='recover'){await jobs.recover();return Response.json({pending:true});}
  if(data.action==='drain')return Response.json(await jobs.processNext());
  if(data.action==='health')return Response.json({ok:true});
  return Response.json({error:'Ação inválida.'},{status:400});
 }catch(error){return Response.json({error:error instanceof MeliError?error.message:'Não foi possível processar o lote.'},{status:error instanceof MeliError?error.status:503});}
}
