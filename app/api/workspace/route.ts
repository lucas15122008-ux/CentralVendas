import {owner,database,errorResponse} from '@/lib/server';
import {loadWorkspace} from '@/lib/workspace-data';

export async function GET(){try{
 return Response.json(await loadWorkspace(database(),await owner()),{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return errorResponse(error)}
}
