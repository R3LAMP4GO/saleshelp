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

export const SALES_RESPONSE_MODES = ["verbatim", "template", "compose"] as const;
export type SalesResponseMode = typeof SALES_RESPONSE_MODES[number];
export const SALES_SCRIPT_VARIABLES = ["configured rep name", "first name", "dealership"] as const;
export type SalesScriptVariable = typeof SALES_SCRIPT_VARIABLES[number];

export interface SalesProfileExpectedAnswer {
  kind: "confirmation" | "free-text" | "entity";
  targetField: string;
}

export interface SalesProfileMove {
  id: string;
  title: string;
  goal: string;
  script: string;
  responseMode: SalesResponseMode;
  maxWords: number;
  variables: readonly SalesScriptVariable[];
  expectedAnswer?: SalesProfileExpectedAnswer;
  terminal?: boolean;
}

export interface SalesProfileRule {
  id: string;
  guidance: string;
}

export interface SalesProfileRuntimePreferences {
  timeoutMs?: number;
  modelBehavior?: "bounded";
}

/** Versioned, editable sales behavior. Safety and claim enforcement remain engine-owned. */
export interface SalesProfileBehavior {
  version: 1;
  objective: string;
  moves: readonly SalesProfileMove[];
  discovery: readonly SalesProfileRule[];
  objections: readonly SalesProfileRule[];
  closeRequirements: readonly string[];
  claimConstraints: readonly string[];
  runtimePreferences: SalesProfileRuntimePreferences;
}

/** An immutable behavior payload selected when a meeting begins. */
export interface ResolvedSalesProfile {
  profileId: string;
  baseVersion: string;
  snapshotVersion: string;
  behavior: SalesProfileBehavior;
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
  behavior: SalesProfileBehavior;
  crmConnectionId?: string;
  followUpPolicyId?: string;
}

const profiles = new Map<string, SalesProfile>();

/** Profiles are registered by approved business-policy packages at module load. */
export function registerSalesProfile(profile: SalesProfile): void {
  if (profiles.has(profile.id)) throw new Error(`Duplicate sales profile: ${profile.id}`);
  validateSalesProfileBehavior(profile.behavior);
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

function profileHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function validateText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000]/.test(normalized)) throw new Error(`${label} must be plain text up to ${maxLength} characters.`);
  return normalized;
}

export function validateSalesProfileBehavior(value: SalesProfileBehavior): SalesProfileBehavior {
  const objective = validateText(value.objective, "Objective", 500);
  if (value.moves.length === 0 || value.moves.length > 80) throw new Error("Profile behavior needs between 1 and 80 moves.");
  const moveIds = new Set<string>();
  const moves = value.moves.map((move) => {
    if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(move.id) || moveIds.has(move.id)) throw new Error("Profile move IDs must be unique and safe.");
    moveIds.add(move.id);
    if (!SALES_RESPONSE_MODES.includes(move.responseMode)) throw new Error(`Move ${move.id} has an unsupported response mode.`);
    const variables = [...new Set(move.variables)];
    if (variables.some((variable) => !SALES_SCRIPT_VARIABLES.includes(variable))) throw new Error(`Move ${move.id} has an unsupported script variable.`);
    const script = validateText(move.script, `Move ${move.id} script`, 500);
    for (const variable of script.matchAll(/\[([^\]]+)\]/g)) {
      if (!variables.includes(variable[1] as SalesScriptVariable)) throw new Error(`Move ${move.id} references an undeclared script variable.`);
    }
    if (!Number.isInteger(move.maxWords) || move.maxWords < 3 || move.maxWords > 60) throw new Error(`Move ${move.id} needs a word limit between 3 and 60.`);
    return Object.freeze({ ...move, title: validateText(move.title, `Move ${move.id} title`, 120), goal: validateText(move.goal, `Move ${move.id} goal`, 500), script, variables: Object.freeze(variables) });
  });
  const rules = (items: readonly SalesProfileRule[], label: string) => Object.freeze(items.map((rule) => Object.freeze({ id: validateText(rule.id, `${label} rule ID`, 80), guidance: validateText(rule.guidance, `${label} guidance`, 12_000) })));
  const closeRequirements = Object.freeze(value.closeRequirements.map((requirement) => validateText(requirement, "Close requirement", 12_000)));
  const claimConstraints = Object.freeze(value.claimConstraints.map((constraint) => validateText(constraint, "Claim constraint", 12_000)));
  const preferences = value.runtimePreferences ?? {};
  if (preferences.timeoutMs !== undefined && (!Number.isInteger(preferences.timeoutMs) || preferences.timeoutMs < 250 || preferences.timeoutMs > 10_000)) throw new Error("Runtime timeout must be between 250 and 10000 ms.");
  if (preferences.modelBehavior !== undefined && preferences.modelBehavior !== "bounded") throw new Error("Unsupported runtime model behavior.");
  return Object.freeze({ version: 1, objective, moves: Object.freeze(moves), discovery: rules(value.discovery, "Discovery"), objections: rules(value.objections, "Objection"), closeRequirements, claimConstraints, runtimePreferences: Object.freeze({ ...preferences }) });
}

export function resolveSalesProfile(profile: SalesProfile, behavior = profile.behavior): ResolvedSalesProfile {
  const validated = validateSalesProfileBehavior(behavior);
  const snapshotVersion = `${profile.profile.version}-${profileHash(JSON.stringify(validated))}`;
  return Object.freeze({ profileId: profile.id, baseVersion: profile.profile.version, snapshotVersion, behavior: validated });
}

export function isApproved(version: VersionedApproval | undefined): boolean {
  return version?.status === "approved" && Boolean(version.version.trim());
}
