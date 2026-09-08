import { customSalesProfileSnapshot, type CustomSalesProfile, type CustomSalesProfileSnapshot } from "./customProfiles";
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
  /** Immutable local source retained with a custom-profile meeting. */
  customProfile?: CustomSalesProfileSnapshot;
  prospect?: SalesProspectReference;
  selectedAt: string;
}

export type SalesRecommendationMetadata = Omit<SalesMeetingMetadata, "prospect">;

/** Keeps policy provenance on recommendations without duplicating prospect identifiers. */
export function salesRecommendationMetadata(metadata: SalesMeetingMetadata): SalesRecommendationMetadata {
  const { prospect: _prospect, ...policy } = metadata;
  return policy;
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

/** Custom profiles retain their source snapshot, but never opt into LotLift policy. */
export function customSalesMeetingMetadata(profile: CustomSalesProfile, prospect?: SalesProspectReference, selectedAt = new Date().toISOString()): SalesMeetingMetadata {
  const snapshot = customSalesProfileSnapshot(profile);
  return {
    salesProfileId: `custom:${snapshot.id}`,
    businessId: snapshot.businessName,
    motion: "cold-outbound",
    profileVersion: snapshot.updatedAt,
    playbookVersion: snapshot.updatedAt,
    productFactsVersion: "none",
    evaluationVersion: "none",
    customProfile: snapshot,
    ...(prospect && Object.values(prospect).some(Boolean) ? { prospect } : {}),
    selectedAt,
  };
}
