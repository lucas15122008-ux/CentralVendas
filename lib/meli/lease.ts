import {randomToken} from './crypto.ts';
export type WriteGuard={sql:string;values:()=>Array<string|number>};
export async function accountLease<T>(db:D1Database,owner:string,id:string,generation:string,now:()=>number,work:(guard:WriteGuard)=>Promise<T>):Promise<T>{
 const lease=randomToken();
 const saved=await db.prepare("INSERT INTO meli_account_leases(account_id,owner_id,generation,lease,lease_until) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM meli_connections WHERE account_id=? AND owner_id=? AND generation=? AND status IN ('connected','refreshing')) ON CONFLICT(account_id) DO UPDATE SET owner_id=excluded.owner_id,generation=excluded.generation,lease=excluded.lease,lease_until=excluded.lease_until WHERE meli_account_leases.lease_until<=? OR meli_account_leases.generation<>excluded.generation RETURNING lease").bind(id,owner,generation,lease,now()+90000,id,owner,generation,now()).first();
 if(!saved)throw new Error('account_busy');
 const guard={sql:"EXISTS(SELECT 1 FROM meli_account_leases l JOIN meli_connections c ON c.account_id=l.account_id AND c.owner_id=l.owner_id WHERE l.account_id=? AND l.owner_id=? AND l.generation=? AND l.lease=? AND l.lease_until>? AND c.generation=l.generation AND c.status='connected')",values:()=>[id,owner,generation,lease,now()]};
 try{return await work(guard)}finally{await db.prepare('DELETE FROM meli_account_leases WHERE account_id=? AND lease=?').bind(id,lease).run();}
}
