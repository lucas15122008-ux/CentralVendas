import CommerceApp from '@/components/commerce-app';
import {getChatGPTUser} from './chatgpt-auth';
export const dynamic='force-dynamic';
export default async function Page(){const user=await getChatGPTUser();return <CommerceApp userName={user?.fullName?.split(' ')[0]||user?.email?.split('@')[0]||'Lucas'} signedIn={!!user}/>;}
