export function requestCoordinator(run:()=>Promise<void>){
 let active:Promise<void>|null=null;
 const poll=()=>active??(active=run().finally(()=>{active=null}));
 const refresh=async()=>{if(active)try{await active}catch{};await poll()};
 return {poll,refresh};
}
