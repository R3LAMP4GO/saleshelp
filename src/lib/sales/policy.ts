import type { SalesMeetingMetadata } from "./meeting";
import { getSalesProfile, isApproved, type ProductFact, type SalesProfile } from "./profiles";

/** Default-deny policy gate for a profile selected at call start. */
export function isApprovedSalesProfile(profile: SalesProfile | null | undefined): profile is SalesProfile {
  return !!profile && isApproved(profile.profile) && isApproved(profile.playbook) && isApproved(profile.productFacts) && isApproved(profile.evaluation);
}

export function resolveApprovedSalesProfile(metadata: SalesMeetingMetadata | null | undefined): SalesProfile | null {
  const profile = getSalesProfile(metadata?.salesProfileId);
  if (!metadata || !isApprovedSalesProfile(profile) || profile.businessId !== metadata.businessId) return null;
  if (profile.motion !== metadata.motion || profile.profile.version !== metadata.profileVersion) return null;
  if (profile.playbook.version !== metadata.playbookVersion || profile.productFacts.version !== metadata.productFactsVersion) return null;
  return profile.evaluation.version === metadata.evaluationVersion ? profile : null;
}

export function approvedProductFacts(profile: SalesProfile, ids: readonly string[]): ProductFact[] | null {
  const facts = ids.map((id) => profile.productFactEntries.find((fact) => fact.id === id));
  return facts.every((fact) => !!fact && isApproved(fact.approval)) ? facts as ProductFact[] : null;
}
