import {owner,database,errorResponse} from '@/lib/server';
export async function GET(){try{const id=await owner();const db=database();const results=await db.batch([
 db.prepare('SELECT id,name,created_at AS createdAt FROM accounts WHERE owner_id=? ORDER BY created_at').bind(id),
 db.prepare('SELECT id,account_id AS accountId,filename,valid_from AS validFrom,row_count AS rowCount,created_at AS createdAt,withdrawn_at AS withdrawnAt,config FROM imports WHERE owner_id=? ORDER BY created_at DESC').bind(id),
 db.prepare('SELECT c.id,c.account_id AS accountId,c.import_id AS importId,c.sku,c.description,c.unit_cost AS unitCost,c.tax_value AS taxValue,c.tax_type AS taxType,c.tax_treatment AS taxTreatment,c.valid_from AS validFrom,c.imported_at AS importedAt FROM cost_versions c JOIN imports i ON i.id=c.import_id WHERE c.owner_id=? AND i.owner_id=? AND i.withdrawn_at IS NULL ORDER BY c.valid_from DESC,c.imported_at DESC').bind(id,id)
 ]);return Response.json({accounts:results[0].results,imports:results[1].results,costs:results[2].results,sales:[]},{headers:{'Cache-Control':'private, no-store'}});}catch(e){return errorResponse(e)}}
