import { validateProfileKnowledgeAttachments, type ProfileKnowledgeAttachment } from "./knowledge";
import {
  resolveSalesProfile,
  validateSalesProfileBehavior,
  type ResolvedSalesProfile,
  type SalesProfile,
  type SalesProfileBehavior,
  type SalesProfileRuntimePreferences,
  type SalesProfileMoveTurnStrategy,
} from "./profiles";

export interface SalesProfileMoveOverride {
  script?: string;
  turnStrategy?: SalesProfileMoveTurnStrategy;
}

/** Local edits for a built-in profile version. Modes and safety rules stay canonical. */
export interface SalesProfileOverride {
  profileId: string;
  baseVersion: string;
  objective?: string;
  moves?: Record<string, SalesProfileMoveOverride>;
  runtimePreferences?: SalesProfileRuntimePreferences;
  knowledgeAttachments?: readonly ProfileKnowledgeAttachment[];
  updatedAt: string;
}

const profileIdPattern = /^[a-z][a-z0-9-]{1,79}$/;

function plainValue(value: string, label: string, max = 500): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\u0000<>]/.test(normalized)) throw new Error(`${label} must be plain text up to ${max} characters.`);
  return normalized;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function duplicateSalesProfileOverride(override: SalesProfileOverride): SalesProfileOverride {
  return clone(override);
}

export function validateSalesProfileOverride(value: SalesProfileOverride, profile: SalesProfile): SalesProfileOverride {
  if (!profileIdPattern.test(value.profileId) || value.profileId !== profile.id) throw new Error("Override profile ID does not match a built-in profile.");
  if (value.baseVersion !== profile.profile.version) throw new Error("Override version does not match the built-in profile.");
  if (!value.updatedAt.trim() || Number.isNaN(Date.parse(value.updatedAt))) throw new Error("Override update time is invalid.");
  const canonicalMoves = new Map(profile.behavior.moves.map((move) => [move.id, move]));
  const moves = Object.entries(value.moves ?? {});
  if (moves.length > canonicalMoves.size) throw new Error("Override contains too many moves.");
  const normalizedMoves: Record<string, SalesProfileMoveOverride> = {};
  for (const [moveId, moveOverride] of moves) {
    const canonical = canonicalMoves.get(moveId);
    if (!canonical || !moveOverride || typeof moveOverride !== "object") throw new Error("Override references an unknown profile move.");
    const script = moveOverride.script === undefined ? undefined : plainValue(moveOverride.script, `${moveId} script`);
    const turnStrategy = moveOverride.turnStrategy === undefined ? undefined : {
      objective: plainValue(moveOverride.turnStrategy.objective, `${moveId} strategy objective`),
      approach: moveOverride.turnStrategy.approach.map((item) => plainValue(item, `${moveId} strategy approach`, 300)).slice(0, 8),
      avoid: moveOverride.turnStrategy.avoid.map((item) => plainValue(item, `${moveId} strategy avoid`, 300)).slice(0, 8),
      desiredProgression: plainValue(moveOverride.turnStrategy.desiredProgression, `${moveId} strategy progression`),
    };
    if (turnStrategy && (!turnStrategy.approach.length || !turnStrategy.avoid.length)) throw new Error(`${moveId} strategy needs approach and avoid guidance.`);
    if (script !== undefined || turnStrategy !== undefined) normalizedMoves[moveId] = { ...(script === undefined ? {} : { script }), ...(turnStrategy === undefined ? {} : { turnStrategy }) };
  }
  const runtimePreferences = value.runtimePreferences ? { ...value.runtimePreferences } : undefined;
  const knowledgeAttachments = value.knowledgeAttachments === undefined ? undefined : validateProfileKnowledgeAttachments(value.knowledgeAttachments);
  const behavior = mergeSalesProfileOverride(profile.behavior, { ...value, moves: normalizedMoves, runtimePreferences });
  validateSalesProfileBehavior(behavior);
  return Object.freeze({
    profileId: profile.id,
    baseVersion: profile.profile.version,
    ...(value.objective === undefined ? {} : { objective: plainValue(value.objective, "Objective") }),
    ...(Object.keys(normalizedMoves).length ? { moves: Object.freeze(normalizedMoves) } : {}),
    ...(runtimePreferences ? { runtimePreferences: Object.freeze(runtimePreferences) } : {}),
    ...(knowledgeAttachments ? { knowledgeAttachments } : {}),
    updatedAt: value.updatedAt,
  });
}

export function mergeSalesProfileOverride(behavior: SalesProfileBehavior, override?: Pick<SalesProfileOverride, "objective" | "moves" | "runtimePreferences">): SalesProfileBehavior {
  if (!override) return behavior;
  const moves = behavior.moves.map((move) => {
    const edited = override.moves?.[move.id];
    return !edited ? move : { ...move, ...(edited.script === undefined ? {} : { script: edited.script }), ...(edited.turnStrategy === undefined ? {} : { turnStrategy: edited.turnStrategy }) };
  });
  return { ...behavior, objective: override.objective ?? behavior.objective, moves, runtimePreferences: { ...behavior.runtimePreferences, ...override.runtimePreferences } };
}

export function resolveSalesProfileOverride(profile: SalesProfile, override?: SalesProfileOverride | null): ResolvedSalesProfile {
  if (!override) return resolveSalesProfile(profile);
  const valid = validateSalesProfileOverride(override, profile);
  return resolveSalesProfile(profile, mergeSalesProfileOverride(profile.behavior, valid), valid.knowledgeAttachments ?? profile.knowledgeAttachments);
}

export function resetSalesProfileMoveOverride(override: SalesProfileOverride, moveId: string): SalesProfileOverride {
  const moves = { ...(override.moves ?? {}) };
  delete moves[moveId];
  return { ...override, ...(Object.keys(moves).length ? { moves } : { moves: undefined }), updatedAt: new Date().toISOString() };
}

export function resetSalesProfileOverride(profile: SalesProfile): SalesProfileOverride {
  return { profileId: profile.id, baseVersion: profile.profile.version, updatedAt: new Date().toISOString() };
}
