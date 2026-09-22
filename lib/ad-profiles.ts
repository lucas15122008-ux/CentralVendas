import type {Sale} from './finance.ts';

export type TaxRule=
 | {mode:'included'}
 | {mode:'unit';valueTenThousandths:number}
 | {mode:'percent';rateBasisPoints:number};

export type OperationOverride='auto'|'full'|'other';

export type AdProfilePayload={
 unitCostTenThousandths:number;
 tax:TaxRule;
 operation:OperationOverride;
};

export type AdProfileEvent={
 id:string;
 accountId:string;
 itemId:string;
 variationId:string|null;
 validFrom:string;
 revision:number;
 action:'set'|'clear';
 payload:AdProfilePayload|null;
 requestId:string;
 reason:string;
 origin:'native'|'legacy';
 createdAt:string;
};

function normalizedVariation(variationId:string|null|undefined){
 if(variationId==='')throw new Error('variationId não pode ser vazio');
 return variationId??null;
}

export function adTargetKey(itemId:string,variationId:string|null|undefined){
 if(!itemId)throw new Error('itemId é obrigatório');
 return JSON.stringify([itemId,normalizedVariation(variationId)]);
}

function effectiveEvents(events:AdProfileEvent[],accountId:string,itemId:string,variationId:string|null|undefined){
 const target=adTargetKey(itemId,variationId);
 const latestByValidity=new Map<string,AdProfileEvent>();
 for(const event of events){
  if(event.accountId!==accountId||adTargetKey(event.itemId,event.variationId)!==target)continue;
  const saved=latestByValidity.get(event.validFrom);
  if(!saved||event.revision>saved.revision)latestByValidity.set(event.validFrom,event);
 }
 return [...latestByValidity.values()]
  .filter(event=>event.action==='set'&&event.payload!==null)
  .sort((a,b)=>b.validFrom.localeCompare(a.validFrom)||b.revision-a.revision||b.createdAt.localeCompare(a.createdAt));
}

export function activeAdProfile(events:AdProfileEvent[],sale:Sale){
 if(!sale.itemId)return undefined;
 return effectiveEvents(events,sale.accountId,sale.itemId,sale.variationId)
  .find(event=>event.validFrom<=sale.date);
}

export function latestAdProfile(events:AdProfileEvent[],accountId:string,itemId:string,variationId?:string|null){
 return effectiveEvents(events,accountId,itemId,variationId)[0];
}
