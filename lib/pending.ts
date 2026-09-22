import type {MigrationIssue} from './ad-profile-migration.ts';
import type {SaleResult} from './finance.ts';
import type {MeliListing} from './meli/catalog.ts';
import type {CorrectableField} from './sale-corrections.ts';

export type PendingKind='missing_profile'|'missing_cost'|'missing_tax'|'missing_meli_field'|'unknown_operation'|'missing_full_reference'|'stale_correction'|'stale_full_closure'|'migration_conflict';
export type PendingItem={
 id:string;kind:PendingKind;accountId:string;saleId?:string;itemId?:string;variationId?:string|null;field?:CorrectableField;
 title:string;message:string;action:'edit_profile'|'correct_sale'|'review_full'|'review_migration';
};

function targetKey(accountId:string,itemId:string,variationId:string|null|undefined){return JSON.stringify([accountId,itemId,variationId??null]);}
function pendingId(kind:PendingKind,values:(string|null|undefined)[]){return ['pending',kind,...values.map(value=>value??'')].join(':');}

export function collectPending(input:{sales:SaleResult[];listings:MeliListing[];migrationIssues:MigrationIssue[]}):PendingItem[]{
 const pending:PendingItem[]=[];
 const seen=new Set<string>();
 const add=(item:PendingItem)=>{if(!seen.has(item.id)){seen.add(item.id);pending.push(item);}};
 const listings=new Map(input.listings.map(row=>[targetKey(row.accountId,row.itemId,row.variationId),row]));
 const missingProfiles=new Set<string>();
 for(const row of input.listings){
  if(row.status==='closed'||row.hasProfile!==false)continue;
  const target=targetKey(row.accountId,row.itemId,row.variationId);missingProfiles.add(target);
  add({id:pendingId('missing_profile',[row.accountId,row.itemId,row.variationId]),kind:'missing_profile',accountId:row.accountId,itemId:row.itemId,variationId:row.variationId,title:row.title,message:'Informe custo e imposto para calcular a margem deste anúncio.',action:'edit_profile'});
 }
 const fields:CorrectableField[]=['revenueCents','feeCents','shippingCents','otherCents','costQuantity'];
 const labels:Record<CorrectableField,string>={revenueCents:'receita',feeCents:'tarifa',shippingCents:'frete do vendedor',otherCents:'despesas promocionais',costQuantity:'quantidade consumida'};
 for(const sale of input.sales){
  if(sale.status==='cancelled'||sale.status==='pending')continue;
  const target=sale.itemId?targetKey(sale.accountId,sale.itemId,sale.variationId):null;
  const title=listings.get(target??'')?.title??sale.title;
  for(const field of fields){
   if(sale[field]!==null)continue;
   add({id:pendingId('missing_meli_field',[sale.accountId,sale.id,field]),kind:'missing_meli_field',accountId:sale.accountId,saleId:sale.id,itemId:sale.itemId,variationId:sale.variationId,field,title,message:`O Mercado Livre ainda não confirmou ${labels[field]}.`,action:'correct_sale'});
  }
  if(sale.costCents===null&&sale.costQuantity!==null&&(!target||!missingProfiles.has(target))){
   add({id:pendingId('missing_cost',[sale.accountId,sale.id]),kind:'missing_cost',accountId:sale.accountId,saleId:sale.id,itemId:sale.itemId,variationId:sale.variationId,title,message:sale.itemId?'Não há custo vigente para esta venda.':'A venda não informa o anúncio necessário para aplicar o custo.',action:sale.itemId?'edit_profile':'correct_sale'});
  }
  if(sale.costCents!==null&&sale.taxCents===null){
   add({id:pendingId('missing_tax',[sale.accountId,sale.id]),kind:'missing_tax',accountId:sale.accountId,saleId:sale.id,itemId:sale.itemId,variationId:sale.variationId,title,message:'Confirme se o imposto está incluído, é unitário ou percentual.',action:'edit_profile'});
  }
  if(sale.operation?.channel==='unknown'){
   add({id:pendingId('unknown_operation',[sale.accountId,sale.id]),kind:'unknown_operation',accountId:sale.accountId,saleId:sale.id,itemId:sale.itemId,variationId:sale.variationId,title,message:'A modalidade logística não foi confirmada; pode existir despesa Full.',action:sale.itemId?'edit_profile':'correct_sale'});
  }
  if(sale.operation?.channel==='full'&&sale.fullExpenseCents===null&&sale.fullClosureState!=='stale'){
   add({id:pendingId('missing_full_reference',[sale.accountId,sale.id]),kind:'missing_full_reference',accountId:sale.accountId,saleId:sale.id,itemId:sale.itemId,variationId:sale.variationId,title,message:'Ainda não existe referência mensal para ratear a despesa Full.',action:'review_full'});
  }
  if(sale.correctionState==='stale'){
   add({id:pendingId('stale_correction',[sale.accountId,sale.id]),kind:'stale_correction',accountId:sale.accountId,saleId:sale.id,itemId:sale.itemId,variationId:sale.variationId,title,message:'O valor oficial mudou depois da correção manual.',action:'correct_sale'});
  }
  if(sale.fullClosureState==='stale'){
   add({id:pendingId('stale_full_closure',[sale.accountId,sale.id]),kind:'stale_full_closure',accountId:sale.accountId,saleId:sale.id,itemId:sale.itemId,variationId:sale.variationId,title,message:'As vendas do mês mudaram depois do fechamento Full.',action:'review_full'});
  }
 }
 for(const issue of input.migrationIssues){
  add({id:pendingId('migration_conflict',[issue.accountId,issue.itemId,issue.variationId,issue.code,issue.message]),kind:'migration_conflict',accountId:issue.accountId,itemId:issue.itemId,variationId:issue.variationId,title:`Migração de ${issue.itemId||'venda histórica'}`,message:issue.message,action:'review_migration'});
 }
 return pending.sort((a,b)=>a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
}
