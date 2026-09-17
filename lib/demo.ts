import {periodStart} from './dates.ts';
import type {CostRecord,Sale} from './finance.ts';
import type {ReconciliationEvent} from './reconciliation.ts';
export type Account={id:string;name:string;createdAt?:string};
export type ImportBatch={id:string;accountId:string;filename:string;validFrom:string;rowCount:number;createdAt:string;withdrawnAt:string|null;config:string};
export type Workspace={accounts:Account[];imports:ImportBatch[];costs:CostRecord[];sales:Sale[];reconciliationEvents:ReconciliationEvent[];syncWarnings?:{accountId:string;name:string;status:string}[]};
export const emptyWorkspace:Workspace={accounts:[],imports:[],costs:[],sales:[],reconciliationEvents:[]};
export function demoWorkspace():Workspace{
 const accounts=[{id:'demo-main',name:'Loja Principal'},{id:'demo-outlet',name:'Loja Outlet'}];
 const products=[['00101','Furadeira de impacto 650W',249.9,143.5],['00102','Kit de ferramentas · 129 peças',189.9,99.6],['00103','Organizador de ferramentas',79.9,32.4],['00104','Lâmpada LED inteligente',49.9,24.8],['00105','Trena profissional · 5 m',39.9,12.9],['00106','Parafusadeira a bateria',329.9,205],['00107','Conjunto de brocas · 15 peças',59.9,21.3],['00108','Extensão elétrica · 5 m',44.9,31.5]] as const;
 const costs:CostRecord[]=accounts.flatMap(a=>products.filter(p=>p[0]!=='00108').map((p,i)=>({id:a.id+p[0],accountId:a.id,sku:p[0],description:p[1],unitCost:p[3],taxValue:i===3?null:6,taxType:'percent',taxTreatment:'additional',validFrom:'2020-01-01',importedAt:'2026-09-01T12:00:00Z',importId:'demo-import'})));
 const sales:Sale[]=[];const today=new Date();
 for(let day=29;day>=0;day--){const iso=periodStart(day+1,today);for(let n=0;n<8+(day*7)%11;n++){const p=products[(day*3+n)%products.length];const quantity=1+(n%5===0?1:0);const accountId=accounts[n%4===0?1:0].id;const revenueCents=Math.round(p[2]*quantity*100);sales.push({id:`d-${day}-${n}`,orderId:`200001${14020+day*23+n}`,accountId,sku:p[0],title:p[1],date:iso,quantity,costQuantity:quantity,revenueCents,feeCents:Math.round(revenueCents*.135),shippingCents:p[2]>79?1280:0,otherCents:quantity*150,status:'paid'});}}
 return {accounts,costs,sales,imports:[],reconciliationEvents:[]};
}
