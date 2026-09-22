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

test('migração cria fechamentos Full auditáveis e agenda releitura logística',()=>{
 const sqlite=new DatabaseSync(':memory:');
 const root=new URL('../drizzle/',import.meta.url);
 const files=readdirSync(root).filter(file=>file.endsWith('.sql')).sort();
 for(const file of files)sqlite.exec(readFileSync(new URL(file,root),'utf8'));
 const tables=sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name);
 assert.ok(tables.includes('full_closure_events'));
 assert.ok(tables.includes('full_closure_allocations'));
 const columns=sqlite.prepare("PRAGMA table_info('meli_connections')").all();
 const version=columns.find(column=>column.name==='logistics_version');
 assert.deepEqual(version&&{notnull:version.notnull,dflt_value:version.dflt_value},{notnull:1,dflt_value:'1'});
 const eventIndexes=sqlite.prepare("PRAGMA index_list('full_closure_events')").all().map(row=>row.name);
 assert.ok(eventIndexes.includes('idx_full_closure_owner_request'));
 assert.ok(eventIndexes.includes('idx_full_closure_revision'));
 assert.ok(eventIndexes.includes('idx_full_closure_owner_month'));
 const allocationIndexes=sqlite.prepare("PRAGMA index_list('full_closure_allocations')").all().map(row=>row.name);
 assert.ok(allocationIndexes.includes('idx_full_allocation_closure_sale'));
 assert.ok(allocationIndexes.includes('idx_full_allocation_owner_account'));
});

test('migração cria fichas, correções, catálogo e rollout auditáveis',()=>{
 const sqlite=new DatabaseSync(':memory:');
 const root=new URL('../drizzle/',import.meta.url);
 const files=readdirSync(root).filter(file=>file.endsWith('.sql')).sort();
 for(const file of files)sqlite.exec(readFileSync(new URL(file,root),'utf8'));
 const tables=sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name);
 assert.ok(tables.includes('ad_profile_events'));
 assert.ok(tables.includes('sale_correction_events'));
 assert.ok(tables.includes('meli_listings'));
 assert.ok(tables.includes('meli_catalog_runs'));
 assert.ok(tables.includes('ad_profile_rollouts'));

 const connectionColumns=sqlite.prepare("PRAGMA table_info('meli_connections')").all();
 const financialsVersion=connectionColumns.find(column=>column.name==='financials_version');
 assert.deepEqual(financialsVersion&&{notnull:financialsVersion.notnull,dflt_value:financialsVersion.dflt_value},{notnull:1,dflt_value:'1'});

 const profileIndexes=sqlite.prepare("PRAGMA index_list('ad_profile_events')").all().map(row=>row.name);
 assert.ok(profileIndexes.includes('idx_ad_profiles_owner_request'));
 assert.ok(profileIndexes.includes('idx_ad_profiles_target_revision'));
 const correctionIndexes=sqlite.prepare("PRAGMA index_list('sale_correction_events')").all().map(row=>row.name);
 assert.ok(correctionIndexes.includes('idx_sale_corrections_owner_request'));
 assert.ok(correctionIndexes.includes('idx_sale_corrections_target_revision'));

 const listingIndexes=sqlite.prepare("PRAGMA index_list('meli_listings')").all().map(row=>row.name);
 assert.ok(listingIndexes.includes('idx_meli_listings_target'));
 const profileColumns=sqlite.prepare("PRAGMA table_info('ad_profile_events')").all();
 const variation=profileColumns.find(column=>column.name==='variation_id');
 assert.deepEqual(variation&&{notnull:variation.notnull,dflt_value:variation.dflt_value},{notnull:1,dflt_value:"''"});
});
