export function allocateCents(total:number,weights:number[]):number[]{
 if(!Number.isSafeInteger(total)||total<0||!weights.length||weights.some(w=>!Number.isFinite(w)||w<0))throw Error('Rateio inválido.');
 const sum=weights.reduce((a,b)=>a+b,0);if(sum===0){if(total===0)return weights.map(()=>0);throw Error('Rateio sem base.');}
 const exact=weights.map(w=>total*w/sum),result=exact.map(Math.floor);let remaining=total-result.reduce((a,b)=>a+b,0);
 for(const {i} of exact.map((v,i)=>({i,remainder:v-result[i]})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i)){if(!remaining)break;result[i]++;remaining--;}
 return result;
}
