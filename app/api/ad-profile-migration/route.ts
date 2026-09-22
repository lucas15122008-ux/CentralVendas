import {z} from 'zod';
import {activateAdProfileMigration,getAdProfileMigrationStatus,type MigrationPlan,type MigrationRolloutState} from '@/lib/ad-profile-migration';
import {database,errorResponse,owner} from '@/lib/server';

const inputSchema=z.object({requestId:z.string().uuid(),expectedSourceStamp:z.string().regex(/^migration-v1:[a-f0-9]{32}$/)});
function response(plan:MigrationPlan,state:MigrationRolloutState,persistedProfileCount:number){return {
 state,sourceStamp:plan.sourceStamp,profileCount:plan.profiles.length,persistedProfileCount,
 issueCount:plan.issues.length,issues:plan.issues,comparedSales:plan.comparedSales,blockingDifferences:plan.blockingDifferences,
};}

export async function GET(){try{
 const user=await owner(),status=await getAdProfileMigrationStatus(database(),user);
 return Response.json(response(status,status.state,status.persistedProfileCount),{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return errorResponse(error);}}

export async function POST(request:Request){try{
 const user=await owner(request);let body:unknown;try{body=await request.json();}catch{return Response.json({error:'Dados da migração inválidos.'},{status:400});}
 const parsed=inputSchema.safeParse(body);if(!parsed.success)return Response.json({error:'Atualize a prévia da migração e tente novamente.'},{status:400});
 const plan=await activateAdProfileMigration(database(),user,parsed.data.expectedSourceStamp);
 const status=await getAdProfileMigrationStatus(database(),user);
 return Response.json(response(plan,status.state,status.persistedProfileCount),{status:plan.blockingDifferences>0?409:200});
 }catch(error){return errorResponse(error);}}
