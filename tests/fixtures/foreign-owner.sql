-- Synthetic fixtures, LOCAL DATABASE ONLY. No source document is uploaded.
INSERT OR IGNORE INTO accounts (id, owner_id, name, created_at)
VALUES ('70000000-0000-4000-8000-000000000001','qa_other_owner','Conta de outro proprietário','2026-01-01T00:00:00Z');
INSERT OR IGNORE INTO imports(id,owner_id,account_id,filename,file_key,fingerprint,config,valid_from,row_count,created_at)
VALUES('70000000-0000-4000-8000-000000000002','qa_other_owner','70000000-0000-4000-8000-000000000001','outro-proprietario.csv','qa/no-file','qa-foreign-fingerprint','{}','2026-01-01',1,'2026-01-01T00:00:00Z');
INSERT OR IGNORE INTO cost_versions(id,owner_id,account_id,import_id,sku,description,unit_cost,tax_value,tax_type,tax_treatment,valid_from,imported_at)
VALUES('70000000-0000-4000-8000-000000000003','qa_other_owner','70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','QA-FOREIGN','Produto privado sintético',90,0,'unit','included','2026-01-01','2026-01-01T00:00:00Z');
