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
DELETE FROM sale_correction_events WHERE owner_id='local_seedy' AND account_id='71000000-0000-4000-8000-000000000001';
DELETE FROM ad_profile_events WHERE owner_id='local_seedy' AND account_id='71000000-0000-4000-8000-000000000001';
DELETE FROM reconciliation_events WHERE owner_id='local_seedy' AND account_id='71000000-0000-4000-8000-000000000001';
DELETE FROM cost_versions WHERE owner_id='local_seedy' AND account_id='71000000-0000-4000-8000-000000000001' AND import_id<>'71000000-0000-4000-8000-000000000002';
DELETE FROM imports WHERE owner_id='local_seedy' AND account_id='71000000-0000-4000-8000-000000000001' AND id<>'71000000-0000-4000-8000-000000000002';
INSERT OR IGNORE INTO imports(id,owner_id,account_id,filename,file_key,fingerprint,config,valid_from,row_count,created_at)
VALUES('71000000-0000-4000-8000-000000000002','local_seedy','71000000-0000-4000-8000-000000000001','conciliacao.csv','qa/no-file','qa-reconciliation-fingerprint','{}','2026-01-01',1,'2026-01-01T00:00:00Z');
INSERT OR IGNORE INTO cost_versions(id,owner_id,account_id,import_id,sku,description,unit_cost,tax_value,tax_type,tax_treatment,valid_from,imported_at)
VALUES('71000000-0000-4000-8000-000000000003','local_seedy','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','64265','Radiador QA',100,0,'unit','included','2026-01-01','2026-01-01T00:00:00Z');
INSERT OR IGNORE INTO meli_orders(id,owner_id,account_id,order_id,date,data,updated_at)
VALUES('71000000-0000-4000-8000-000000000004','local_seedy','71000000-0000-4000-8000-000000000001','9001','2026-09-17','[{"id":"71000000-0000-4000-8000-000000000001:9001:0","orderId":"9001","accountId":"71000000-0000-4000-8000-000000000001","sku":"SEM-SKU","itemId":"MLB-QA-1","variationId":"FULL","title":"Radiador QA","date":"2026-09-17","quantity":1,"costQuantity":1,"grossSalesCents":25000,"revenueCents":25000,"feeCents":2500,"shippingCents":1000,"otherCents":0,"status":"paid","source":"mercadolivre"}]',1789632000000);

-- Ofertas sintéticas Full e comum do mesmo SKU para testar fechamento mensal.
INSERT OR IGNORE INTO accounts (id, owner_id, name, created_at)
VALUES ('72000000-0000-4000-8000-000000000001','local_seedy','Conta QA fechamento Full','2026-01-01T00:00:00Z');
DELETE FROM sale_correction_events WHERE owner_id='local_seedy' AND account_id='72000000-0000-4000-8000-000000000001';
DELETE FROM ad_profile_events WHERE owner_id='local_seedy' AND account_id='72000000-0000-4000-8000-000000000001';
DELETE FROM full_closure_allocations WHERE owner_id='local_seedy' AND account_id='72000000-0000-4000-8000-000000000001';
DELETE FROM full_closure_events WHERE owner_id='local_seedy' AND account_id='72000000-0000-4000-8000-000000000001';
DELETE FROM reconciliation_events WHERE owner_id='local_seedy' AND account_id='72000000-0000-4000-8000-000000000001';
INSERT OR IGNORE INTO imports(id,owner_id,account_id,filename,file_key,fingerprint,config,valid_from,row_count,created_at)
VALUES('72000000-0000-4000-8000-000000000002','local_seedy','72000000-0000-4000-8000-000000000001','full.csv','qa/no-file','qa-full-fingerprint','{}','2026-01-01',1,'2026-01-01T00:00:00Z');
INSERT OR IGNORE INTO cost_versions(id,owner_id,account_id,import_id,sku,description,unit_cost,tax_value,tax_type,tax_treatment,valid_from,imported_at)
VALUES('72000000-0000-4000-8000-000000000003','local_seedy','72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002','64265','Radiador QA',100,0,'unit','included','2026-01-01','2026-01-01T00:00:00Z');
INSERT OR REPLACE INTO meli_orders(id,owner_id,account_id,order_id,date,data,updated_at)
VALUES
('72000000-0000-4000-8000-000000000004','local_seedy','72000000-0000-4000-8000-000000000001','9101','2026-09-17','[{"id":"72000000-0000-4000-8000-000000000001:9101:0","orderId":"9101","accountId":"72000000-0000-4000-8000-000000000001","sku":"64265","itemId":"MLB-QA-FULL","variationId":null,"logisticType":"fulfillment","title":"Radiador Full","date":"2026-09-17","quantity":2,"costQuantity":2,"grossSalesCents":50000,"revenueCents":50000,"feeCents":5000,"shippingCents":2000,"otherCents":0,"status":"paid","source":"mercadolivre"}]',1789632000000),
('72000000-0000-4000-8000-000000000005','local_seedy','72000000-0000-4000-8000-000000000001','9102','2026-09-17','[{"id":"72000000-0000-4000-8000-000000000001:9102:0","orderId":"9102","accountId":"72000000-0000-4000-8000-000000000001","sku":"64265","itemId":"MLB-QA-COMMON","variationId":null,"logisticType":"cross_docking","title":"Radiador comum","date":"2026-09-17","quantity":3,"costQuantity":3,"grossSalesCents":75000,"revenueCents":75000,"feeCents":7500,"shippingCents":3000,"otherCents":0,"status":"paid","source":"mercadolivre"}]',1789632000000),
('72000000-0000-4000-8000-000000000006','local_seedy','72000000-0000-4000-8000-000000000001','9103','2026-09-18','[{"id":"72000000-0000-4000-8000-000000000001:9103:0","orderId":"9103","accountId":"72000000-0000-4000-8000-000000000001","sku":"64265","itemId":"MLB-QA-FULL","variationId":null,"logisticType":"fulfillment","title":"Radiador Full pendente","date":"2026-09-18","quantity":1,"costQuantity":1,"grossSalesCents":25000,"revenueCents":25000,"feeCents":2500,"shippingCents":1000,"otherCents":0,"status":"pending","source":"mercadolivre"}]',1789718400000);

-- IDs de venda duplicados provocam falha de parcela para validar rollback atômico.
INSERT OR IGNORE INTO accounts (id, owner_id, name, created_at)
VALUES ('73000000-0000-4000-8000-000000000001','local_seedy','Conta QA rollback Full','2026-01-01T00:00:00Z');
DELETE FROM full_closure_allocations WHERE owner_id='local_seedy' AND account_id='73000000-0000-4000-8000-000000000001';
DELETE FROM full_closure_events WHERE owner_id='local_seedy' AND account_id='73000000-0000-4000-8000-000000000001';
INSERT OR IGNORE INTO imports(id,owner_id,account_id,filename,file_key,fingerprint,config,valid_from,row_count,created_at)
VALUES('73000000-0000-4000-8000-000000000002','local_seedy','73000000-0000-4000-8000-000000000001','rollback.csv','qa/no-file','qa-full-rollback-fingerprint','{}','2026-01-01',1,'2026-01-01T00:00:00Z');
INSERT OR IGNORE INTO cost_versions(id,owner_id,account_id,import_id,sku,description,unit_cost,tax_value,tax_type,tax_treatment,valid_from,imported_at)
VALUES('73000000-0000-4000-8000-000000000003','local_seedy','73000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002','DUP','Produto duplicado QA',10,0,'unit','included','2026-01-01','2026-01-01T00:00:00Z');
INSERT OR REPLACE INTO meli_orders(id,owner_id,account_id,order_id,date,data,updated_at)
VALUES
('73000000-0000-4000-8000-000000000004','local_seedy','73000000-0000-4000-8000-000000000001','9201','2026-09-17','[{"id":"duplicate-sale","orderId":"9201","accountId":"73000000-0000-4000-8000-000000000001","sku":"DUP","logisticType":"fulfillment","title":"Duplicado A","date":"2026-09-17","quantity":1,"costQuantity":1,"grossSalesCents":1000,"revenueCents":1000,"feeCents":0,"shippingCents":0,"otherCents":0,"status":"paid","source":"mercadolivre"}]',1789632000000),
('73000000-0000-4000-8000-000000000005','local_seedy','73000000-0000-4000-8000-000000000001','9202','2026-09-17','[{"id":"duplicate-sale","orderId":"9202","accountId":"73000000-0000-4000-8000-000000000001","sku":"DUP","logisticType":"fulfillment","title":"Duplicado B","date":"2026-09-17","quantity":1,"costQuantity":1,"grossSalesCents":1000,"revenueCents":1000,"feeCents":0,"shippingCents":0,"otherCents":0,"status":"paid","source":"mercadolivre"}]',1789632000001);
