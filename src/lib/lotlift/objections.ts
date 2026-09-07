import type { LotLiftPlaybookSection } from "./playbook";

export interface ApprovedLotLiftResponse {
  id: "not-interested" | "price" | "price-with-spouse" | "existing-solution" | "do-not-call";
  title: string;
  response: string;
  consideration: string;
  rule: LotLiftPlaybookSection[];
}

const RESPONSES: Array<ApprovedLotLiftResponse & { pattern: RegExp }> = [
  {
    id: "do-not-call",
    title: "Do-not-call request",
    pattern: /\b(take (me|us) off|do not call|don't call|remove (me|us))\b/i,
    response: "Absolutely. I’ll mark this number do-not-call. Thanks for letting me know.",
    consideration: "Confirm the opt-out and end the call; do not continue selling.",
    rule: ["Objection response model", "What not to say"],
  },
  {
    id: "price",
    title: "Price concern",
    pattern: /\b(too expensive|too much money|no budget|can'?t afford|costs? too much)\b/i,
    response: "That’s fair. Is the concern the monthly number, setup effort, comparison with another option, or that the return is not clear enough?",
    consideration: "Isolate the real concern before discussing scope or price.",
    rule: ["Objection response model", "Qualification rules"],
  },
  {
    id: "not-interested",
    title: "Not interested",
    pattern: /\b(not interested|not a priority|no thanks)\b/i,
    response: "Fair enough. Before I close this out, is that because marketplace inquiries are already consistently covered there, or because it is not a priority right now?",
    consideration: "Ask once to understand the reason, then honor a second no.",
    rule: ["Objection response model", "What not to say"],
  },
  {
    id: "existing-solution",
    title: "Existing solution",
    pattern: /\b(crm|bdc|internet department|salespeople handle|already handle)\b/i,
    response: "That makes sense. When a marketplace inquiry arrives, does it land directly in that workflow and get owned immediately, or is there still an inbox and handoff?",
    consideration: "Test coverage respectfully; disqualify cleanly if their process truly covers it.",
    rule: ["Objection response model", "Discovery sequence"],
  },
];

/** Deterministic local retrieval that keeps prior decision-maker context in scope. */
export function retrieveApprovedLotLiftResponse(text: string, priorProspectLines: readonly string[] = []): ApprovedLotLiftResponse | null {
  const matched = RESPONSES.find(({ pattern }) => pattern.test(text));
  if (!matched) return null;
  const hasSpouseContext = priorProspectLines.some((line) => /\b(wife|husband|spouse|partner)\b/i.test(line));
  if (matched.id === "price" && hasSpouseContext) {
    return {
      ...matched,
      id: "price-with-spouse",
      title: "Price concern with spouse context",
      response: "That makes sense. When you talk with your wife, is the concern the monthly number, setup effort, comparison with another option, or that the return is not clear enough?",
      consideration: "Keep the stated decision-maker context, then isolate the real concern before discussing scope or price.",
    };
  }
  return matched;
}
