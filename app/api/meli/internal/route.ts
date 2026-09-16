import {env} from 'cloudflare:workers';
import {meli} from '@/lib/meli/server';
import {handleAutomationRequest} from '@/lib/meli/internal';
export async function POST(request:Request){return handleAutomationRequest(request,meli(),env.MELI_AUTOMATION_SECRET??'');}
