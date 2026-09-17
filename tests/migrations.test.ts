import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

test('migração do faturamento marca conexões existentes para releitura',()=>{
 const sqlite=new DatabaseSync(':memory:');
 const root=new URL('../drizzle/',import.meta.url);
 const files=readdirSync(root).filter(file=>file.endsWith('.sql')).sort();
 for(const file of files.filter(file=>file<='0004_true_ares.sql'))sqlite.exec(readFileSync(new URL(file,root),'utf8'));
 sqlite.exec("INSERT INTO accounts VALUES ('a','owner','Loja','2026-01-01')");
 sqlite.exec("INSERT INTO meli_connections(account_id,owner_id,status,generation,updated_at,sync_cursor) VALUES('a','owner','connected','g',1,'2026-09-17T00:00:00.000Z')");
 sqlite.exec("INSERT INTO meli_sync_runs(account_id,owner_id,generation,id,mode,from_date,to_date,offset,status,lease,lease_until,updated_at) VALUES('a','owner','g','r','incremental','2026-09-16T00:00:00.000Z','2026-09-17T00:00:00.000Z',5,'running','lease',999999,1)");
 for(const file of files.filter(file=>file>'0004_true_ares.sql'))sqlite.exec(readFileSync(new URL(file,root),'utf8'));
 const columns=sqlite.prepare("PRAGMA table_info('meli_connections')").all();
 const version=columns.find(column=>column.name==='gross_sales_version');
 assert.deepEqual(version&&{notnull:version.notnull,dflt_value:version.dflt_value},{notnull:1,dflt_value:'1'});
});
