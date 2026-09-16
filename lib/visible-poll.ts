type PollEnvironment={visibility:()=>string;listen:(callback:()=>void)=>()=>void;schedule:(callback:()=>void)=>()=>void};
export function visiblePoll(task:()=>Promise<unknown>,env:PollEnvironment={visibility:()=>document.visibilityState,listen:callback=>{document.addEventListener('visibilitychange',callback);return()=>document.removeEventListener('visibilitychange',callback)},schedule:callback=>{const timer=setTimeout(callback,15000);return()=>clearTimeout(timer)}}){
 let stopped=false,running=false,cancel:(()=>void)|undefined;
 const schedule=()=>{cancel?.();cancel=undefined;if(!stopped&&env.visibility()==='visible')cancel=env.schedule(()=>{void run()})};
 const run=async()=>{cancel?.();cancel=undefined;if(stopped||running||env.visibility()!=='visible')return;running=true;try{await task()}finally{running=false;schedule()}};
 const unlisten=env.listen(()=>{cancel?.();cancel=undefined;if(env.visibility()==='visible')void run()});schedule();
 return()=>{stopped=true;cancel?.();unlisten()};
}
