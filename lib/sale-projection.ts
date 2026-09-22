import type {AdProfileEvent,OperationOverride} from './ad-profiles.ts';
import {activeAdProfile} from './ad-profiles.ts';
import type {Sale,SalesChannel} from './finance.ts';
import {resolveOperation} from './reconciliation.ts';

export type FinancialSource=
 | 'meli'
 | 'ad_profile'
 | 'full_estimate'
 | 'full_closure'
 | 'manual_fallback'
 | 'manual_override';

function configuredChannel(operation:OperationOverride):SalesChannel{
 return operation==='auto'?'unknown':operation;
}

function meliSources(sale:Sale):Sale['fieldSources']{
 return {
  ...(sale.revenueCents!==null?{revenueCents:'meli' as const}:{}),
  ...(sale.feeCents!==null?{feeCents:'meli' as const}:{}),
  ...(sale.shippingCents!==null?{shippingCents:'meli' as const}:{}),
  ...(sale.otherCents!==null?{otherCents:'meli' as const}:{}),
  ...(sale.costQuantity!==null?{costQuantity:'meli' as const}:{}),
 };
}

export function applyAdProfiles(sales:Sale[],profiles:AdProfileEvent[]):Sale[]{
 return sales.map(sale=>{
  const profile=activeAdProfile(profiles,sale);
  const manualChannel=sale.reconciliation?.state==='manual'?sale.reconciliation.channel:'unknown';
  const productChannel=profile?.payload?configuredChannel(profile.payload.operation):'unknown';
  const fieldSources={
   ...meliSources(sale),
   ...sale.fieldSources,
   ...(profile?{costCents:'ad_profile' as const,taxCents:'ad_profile' as const}:{}),
  };
  return {
   ...sale,
   ...(profile?.payload?{
    adProfile:{
     eventId:profile.id,
     revision:profile.revision,
     validFrom:profile.validFrom,
     unitCostTenThousandths:profile.payload.unitCostTenThousandths,
     tax:profile.payload.tax,
    },
   }:{adProfile:undefined}),
   fieldSources,
   operation:resolveOperation(sale.logisticType,manualChannel,productChannel),
  };
 });
}
