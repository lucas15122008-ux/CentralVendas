import type {AdProfileEvent,OperationOverride} from './ad-profiles.ts';
import {activeAdProfile} from './ad-profiles.ts';
import {calculateSale,type CostRecord,type Sale,type SaleResult,type SalesChannel} from './finance.ts';
import {applyFullClosures,type FullClosure} from './full-reconciliation.ts';
import {applyReconciliation,resolveOperation,type ReconciliationEvent} from './reconciliation.ts';
import {applySaleCorrections,type SaleCorrectionEvent} from './sale-corrections.ts';

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

export type SaleProjectionInput={
 rawSales:Sale[];
 legacyCosts:CostRecord[];
 reconciliationEvents:ReconciliationEvent[];
 profiles:AdProfileEvent[];
 corrections:SaleCorrectionEvent[];
 closures:FullClosure[];
 rolloutState:'pending'|'blocked'|'active';
};
export type SaleProjection={sales:Sale[];results:SaleResult[];calculationCosts:CostRecord[]};

function withoutLegacyProductLink(original:Sale):Sale{
 const sale:Sale={...original,financialMode:'native'};
 delete sale.costSku;delete sale.linkRevision;delete sale.linkValidFrom;delete sale.adProfile;
 if(sale.operation?.source==='product')delete sale.operation;
 return sale;
}

export function projectSales(input:SaleProjectionInput):SaleProjection{
 const legacy=applyReconciliation(input.rawSales,input.legacyCosts,input.reconciliationEvents);
 if(input.rolloutState!=='active'){
  const sales=applyFullClosures(legacy,input.closures),calculationCosts=input.legacyCosts;
  return {sales,results:sales.map(sale=>calculateSale(sale,calculationCosts)),calculationCosts};
 }
 const historical=legacy.map(withoutLegacyProductLink);
 const corrected=historical.map(sale=>applySaleCorrections(sale,input.corrections));
 const profiled=applyAdProfiles(corrected,input.profiles);
 const sales=applyFullClosures(profiled,input.closures),calculationCosts:CostRecord[]=[];
 return {sales,results:sales.map(sale=>calculateSale(sale,calculationCosts)),calculationCosts};
}
