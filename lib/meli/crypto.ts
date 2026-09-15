const encoder=new TextEncoder();
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=(text:string)=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export const randomToken=(length=32)=>encode(crypto.getRandomValues(new Uint8Array(length)));
async function keyFrom(secret:string){const bytes=decode(secret);if(bytes.length!==32)throw Error('Chave de proteção inválida.');return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);}
export async function seal(value:string,secret:string,context:string){const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(context)},await keyFrom(secret),encoder.encode(value));return `v1.${encode(iv)}.${encode(new Uint8Array(cipher))}`;}
export async function unseal(value:string,secret:string,context:string){const [version,iv,cipher,...extra]=value.split('.');if(version!=='v1'||!iv||!cipher||extra.length)throw Error('Segredo protegido inválido.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv),additionalData:encoder.encode(context)},await keyFrom(secret),decode(cipher)));}
export async function pkceChallenge(verifier:string){return encode(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(verifier))));}
