export function businessDate(now=new Date()):string {
 return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function periodStart(days:number,now=new Date()):string {
 const date=new Date(businessDate(now)+'T12:00:00Z');
 date.setUTCDate(date.getUTCDate()-Math.max(0,days-1));
 return date.toISOString().slice(0,10);
}
