import type { SalesMotion, SalesProfile } from "./profiles";

export interface SalesProspectReference {
  name?: string;
  role?: string;
  /** Normalized only for business-scoped DNC matching; never a conversation fact. */
  phone?: string;
  crmLeadId?: string;
}

/** Immutable business-policy selection captured when a sales call starts. */
export interface SalesMeetingMetadata {
  salesProfileId: string;
  businessId: string;
  motion: SalesMotion;
  profileVersion: string;
  playbookVersion: string;
  productFactsVersion: string;
  evaluationVersion: string;
  prospect?: SalesProspectReference;
  selectedAt: string;
}

export function salesMeetingMetadata(profile: SalesProfile, prospect?: SalesProspectReference, selectedAt = new Date().toISOString()): SalesMeetingMetadata {
  return {
    salesProfileId: profile.id,
    businessId: profile.businessId,
    motion: profile.motion,
    profileVersion: profile.profile.version,
    playbookVersion: profile.playbook.version,
    productFactsVersion: profile.productFacts.version,
    evaluationVersion: profile.evaluation.version,
    ...(prospect && Object.values(prospect).some(Boolean) ? { prospect } : {}),
    selectedAt,
  };
}
