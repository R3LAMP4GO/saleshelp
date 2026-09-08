export type SalesMotion = "cold-outbound";
export type ApprovalStatus = "approved" | "draft" | "disabled";

export interface VersionedApproval {
  version: string;
  status: ApprovalStatus;
}

export interface ProductFact {
  id: string;
  version: string;
  statement: string;
  approval: VersionedApproval;
}

export interface SalesResponsePolicy {
  /** Whether contextual generated replies may contain product facts. */
  allowCitedProductFacts: boolean;
  /** Whether an exact, approved card can be used when generation is unavailable. */
  allowDeterministicFallback: boolean;
}

export interface SalesProfile {
  id: string;
  businessId: string;
  label: string;
  motion: SalesMotion;
  profile: VersionedApproval;
  playbook: VersionedApproval;
  productFacts: VersionedApproval;
  evaluation: VersionedApproval;
  vocabulary: readonly string[];
  qualificationFields: readonly string[];
  prohibitedClaims: readonly string[];
  responsePolicy: SalesResponsePolicy;
  productFactEntries: readonly ProductFact[];
  crmConnectionId?: string;
  followUpPolicyId?: string;
}

const profiles = new Map<string, SalesProfile>();

/** Profiles are registered by approved business-policy packages at module load. */
export function registerSalesProfile(profile: SalesProfile): void {
  if (profiles.has(profile.id)) throw new Error(`Duplicate sales profile: ${profile.id}`);
  profiles.set(profile.id, profile);
}

export function getSalesProfile(profileId: string | null | undefined): SalesProfile | null {
  return profileId ? profiles.get(profileId) ?? null : null;
}

export function availableSalesProfiles(): readonly SalesProfile[] {
  return [...profiles.values()].filter((profile) =>
    isApproved(profile.profile) && isApproved(profile.playbook) && isApproved(profile.productFacts) && isApproved(profile.evaluation)
  );
}

export function isApproved(version: VersionedApproval | undefined): boolean {
  return version?.status === "approved" && Boolean(version.version.trim());
}
