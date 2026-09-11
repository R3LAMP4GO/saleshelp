import { customSalesProfileSnapshot, type CustomSalesProfile, type CustomSalesProfileSnapshot } from "./customProfiles";
import { validateKnowledgeSnapshotReferences, type KnowledgeSnapshotReference } from "./knowledge";
import { resolveSalesProfile, type ResolvedSalesProfile, type SalesMotion, type SalesProfile } from "./profiles";

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
  /** Immutable effective built-in behavior, including any local override. */
  resolvedProfile?: ResolvedSalesProfile;
  /** Immutable source versions selected before the call starts. */
  knowledgeSnapshots?: readonly KnowledgeSnapshotReference[];
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

export function salesMeetingMetadata(profile: SalesProfile, prospect?: SalesProspectReference, selectedAt = new Date().toISOString(), resolvedProfile = resolveSalesProfile(profile), knowledgeSnapshots?: readonly KnowledgeSnapshotReference[]): SalesMeetingMetadata {
  if (resolvedProfile.profileId !== profile.id || resolvedProfile.baseVersion !== profile.profile.version) throw new Error("Resolved profile does not match the selected profile.");
  const snapshots = validateKnowledgeSnapshotReferences(knowledgeSnapshots);
  const attachedSources = new Set(resolvedProfile.knowledgeAttachments.filter((item) => item.enabled).map((item) => item.sourceId));
  if (snapshots.some((snapshot) => !attachedSources.has(snapshot.sourceId))) throw new Error("Knowledge snapshot is not enabled for the selected profile.");
  return {
    salesProfileId: profile.id,
    businessId: profile.businessId,
    motion: profile.motion,
    profileVersion: profile.profile.version,
    playbookVersion: profile.playbook.version,
    productFactsVersion: profile.productFacts.version,
    evaluationVersion: profile.evaluation.version,
    resolvedProfile,
    ...(snapshots.length ? { knowledgeSnapshots: snapshots } : {}),
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
    productFactsVersion: snapshot.compiledProfile ? String(snapshot.compiledProfile.version) : "none",
    evaluationVersion: "none",
    customProfile: snapshot,
    ...(prospect && Object.values(prospect).some(Boolean) ? { prospect } : {}),
    selectedAt,
  };
}
