-- Synthetic fixtures, LOCAL DATABASE ONLY. No source document is uploaded.
INSERT OR IGNORE INTO accounts (id, owner_id, name, created_at)
VALUES ('70000000-0000-4000-8000-000000000001','qa_other_owner','Conta de outro proprietário','2026-01-01T00:00:00Z');
INSERT OR IGNORE INTO imports(id,owner_id,account_id,filename,file_key,fingerprint,config,valid_from,row_count,created_at)
VALUES('70000000-0000-4000-8000-000000000002','qa_other_owner','70000000-0000-4000-8000-000000000001','outro-proprietario.csv','qa/no-file','qa-foreign-fingerprint','{}','2026-01-01',1,'2026-01-01T00:00:00Z');
INSERT OR IGNORE INTO cost_versions(id,owner_id,account_id,import_id,sku,description,unit_cost,tax_value,tax_type,tax_treatment,valid_from,imported_at)
VALUES('70000000-0000-4000-8000-000000000003','qa_other_owner','70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','QA-FOREIGN','Produto privado sintético',90,0,'unit','included','2026-01-01','2026-01-01T00:00:00Z');

-- Venda sintética do usuário local para testar a conciliação sem chamar APIs externas.
INSERT OR IGNORE INTO accounts (id, owner_id, name, created_at)
VALUES ('71000000-0000-4000-8000-000000000001','local_seedy','Conta QA conciliação','2026-01-01T00:00:00Z');
DELETE FROM reconciliation_events WHERE owner_id='local_seedy' AND account_id='71000000-0000-4000-8000-000000000001';
DELETE FROM cost_versions WHERE owner_id='local_seedy' AND account_id='71000000-0000-4000-8000-000000000001' AND import_id<>'71000000-0000-4000-8000-000000000002';
DELETE FROM imports WHERE owner_id='local_seedy' AND account_id='71000000-0000-4000-8000-000000000001' AND id<>'71000000-0000-4000-8000-000000000002';
INSERT OR IGNORE INTO imports(id,owner_id,account_id,filename,file_key,fingerprint,config,valid_from,row_count,created_at)
VALUES('71000000-0000-4000-8000-000000000002','local_seedy','71000000-0000-4000-8000-000000000001','conciliacao.csv','qa/no-file','qa-reconciliation-fingerprint','{}','2026-01-01',1,'2026-01-01T00:00:00Z');
INSERT OR IGNORE INTO cost_versions(id,owner_id,account_id,import_id,sku,description,unit_cost,tax_value,tax_type,tax_treatment,valid_from,imported_at)
VALUES('71000000-0000-4000-8000-000000000003','local_seedy','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','64265','Radiador QA',100,0,'unit','included','2026-01-01','2026-01-01T00:00:00Z');
INSERT OR IGNORE INTO meli_orders(id,owner_id,account_id,order_id,date,data,updated_at)
VALUES('71000000-0000-4000-8000-000000000004','local_seedy','71000000-0000-4000-8000-000000000001','9001','2026-09-17','[{"id":"71000000-0000-4000-8000-000000000001:9001:0","orderId":"9001","accountId":"71000000-0000-4000-8000-000000000001","sku":"SEM-SKU","itemId":"MLB-QA-1","variationId":"FULL","title":"Radiador QA","date":"2026-09-17","quantity":1,"costQuantity":1,"grossSalesCents":25000,"revenueCents":25000,"feeCents":2500,"shippingCents":1000,"otherCents":0,"status":"paid","source":"mercadolivre"}]',1789632000000);
