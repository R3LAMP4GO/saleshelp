import { VOCABULARY_LIMIT } from "../dictionary";
import type { SalesMeetingMetadata } from "./meeting";
import { getSalesProfile } from "./profiles";

/** Active business terms lead the bounded STT bias list without displacing a matching profile. */
export function salesVocabularyTerms(globalTerms: readonly string[], metadata: SalesMeetingMetadata | null | undefined): string[] {
  const profile = getSalesProfile(metadata?.salesProfileId);
  const profileTerms = profile && profile.businessId === metadata?.businessId ? profile.vocabulary : [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const candidate of [...profileTerms, ...globalTerms]) {
    const term = candidate.trim();
    const normalized = term.toLocaleLowerCase();
    if (!term || seen.has(normalized)) continue;
    seen.add(normalized);
    terms.push(term);
    if (terms.length === VOCABULARY_LIMIT) break;
  }
  return terms;
}
