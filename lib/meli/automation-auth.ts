import {randomToken} from './crypto.ts';

export const AUTOMATION_PATH='/api/meli/internal';
export const AUTOMATION_BODY_LIMIT=16384;
const MAX_CLOCK_SKEW=180000;
const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
const canonical=async(body:string,time:string,nonce:string)=>encoder.encode(`POST\n${AUTOMATION_PATH}\n${time}\n${nonce}\n${hex(await crypto.subtle.digest('SHA-256',encoder.encode(body)))}`);
const key=(secret:string)=>crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);

export async function signAutomationHeaders(body:string,secret:string,now=Date.now(),nonce=randomToken()):Promise<Record<string,string>>{
 if(secret.length<32)throw Error('Chave da automação não configurada.');
 const time=String(now);
 const signature=hex(await crypto.subtle.sign('HMAC',await key(secret),await canonical(body,time,nonce)));
 return {'Content-Type':'application/json','x-meli-automation-time':time,'x-meli-automation-nonce':nonce,'x-meli-automation-signature':signature};
}

export async function verifyAutomationRequest(request:Request,body:string,secret:string,claimNonce:(nonce:string,expiresAt:number)=>Promise<boolean>,now=Date.now()):Promise<boolean>{
 const url=new URL(request.url);
 if(secret.length<32||request.method!=='POST'||url.pathname!==AUTOMATION_PATH||url.search||encoder.encode(body).byteLength>AUTOMATION_BODY_LIMIT)return false;
 const time=request.headers.get('x-meli-automation-time')??'';
 const nonce=request.headers.get('x-meli-automation-nonce')??'';
 const signature=request.headers.get('x-meli-automation-signature')??'';
 if(!/^\d{13}$/.test(time)||Math.abs(now-Number(time))>MAX_CLOCK_SKEW||!/^[A-Za-z0-9_-]{43}$/.test(nonce)||!/^[a-f0-9]{64}$/.test(signature))return false;
 const bytes=Uint8Array.from(signature.match(/../g)!,v=>Number.parseInt(v,16));
 if(!await crypto.subtle.verify('HMAC',await key(secret),bytes,await canonical(body,time,nonce)))return false;
 // Claim only after verification: unauthenticated callers cannot fill nonce storage.
 return claimNonce(nonce,Number(time)+MAX_CLOCK_SKEW+1);
}
