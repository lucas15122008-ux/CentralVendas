import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {MeliService} from '../../lib/meli/service.ts';
import {randomToken} from '../../lib/meli/crypto.ts';
export function setup(){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../../drizzle/'+file,import.meta.url),'utf8'));
 sqlite.exec("INSERT INTO accounts VALUES ('a','owner','Loja','2026-01-01'),('b','other','Outra','2026-01-01')");
 const prepare=(sql:string)=>{let values:unknown[]=[];const statement={bind(...v:unknown[]){values=v;return statement},async first(){return sqlite.prepare(sql).get(...values as [])??null},async all(){return {results:sqlite.prepare(sql).all(...values as [])}},async run(){const result=sqlite.prepare(sql).run(...values as []);return {meta:{changes:Number(result.changes)}}}};return statement};
 const db={prepare,async batch(statements:ReturnType<typeof prepare>[]){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.all());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}}};
 let now=Date.parse('2026-09-15T15:00:00Z');let handler:(url:URL,init?:RequestInit)=>Promise<Response>=async(url)=>{if(url.pathname==='/oauth/token')return Response.json({access_token:'access',refresh_token:'refresh',expires_in:21600,user_id:456,token_type:'bearer'});if(url.pathname==='/users/me')return Response.json({id:456,nickname:'LOJA',site_id:'MLB'});throw Error('Unexpected endpoint '+url.pathname)};
 const service=new MeliService(db as never,randomToken(32),async(input,init)=>handler(new URL(String(input)),init),()=>now);
 const configure=()=>service.configure('owner',{clientId:'123',clientSecret:'secret-example',pkce:true});
 const authorize=async()=>{await configure();const flow=await service.connect('owner','a');await service.callback('owner',flow.state,flow.browser,'code');return flow};
 return {service,sqlite,configure,authorize,setHandler(fn:typeof handler){handler=fn},advance(ms:number){now+=ms}};
}
export const order=(id=100,price=100)=>({id,seller:{id:456},status:'paid',date_created:'2026-09-14T15:00:00Z',currency_id:'BRL',order_items:[{item:{id:'MLB123',title:'Produto',seller_sku:'00001'},quantity:1,unit_price:price,sale_fee:13}],shipping:{id:789},payments:[{status:'approved',transaction_amount_refunded:0}]});
