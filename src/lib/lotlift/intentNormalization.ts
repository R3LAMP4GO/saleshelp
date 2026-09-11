/** Matching-only normalization. Transcript text remains unchanged for evidence and display. */
export function normalizeForIntent(rawText: string): string {
  return rawText
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}
