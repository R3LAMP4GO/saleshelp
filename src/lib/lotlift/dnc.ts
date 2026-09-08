import type { LotLiftPlaybookRuleId } from "./playbook";

export interface DoNotContactResponse {
  id: "do-not-call";
  title: string;
  response: string;
  consideration: string;
  rule_id: LotLiftPlaybookRuleId;
}

const DO_NOT_CONTACT_PATTERN = /\b(?:don['’]t call(?: again)?|do not call|remove (?:me|us)(?: from (?:your )?list)?|take (?:me|us) off (?:your )?list|stop calling)\b/i;

/** Safety invariant: this acknowledgement never depends on Markdown parsing or model output. */
export const DO_NOT_CONTACT_RESPONSE: DoNotContactResponse = {
  id: "do-not-call",
  title: "Do-not-call request",
  response: "Absolutely. I’ll mark this number do-not-call. Thanks for letting me know.",
  consideration: "Confirm the opt-out and end the call; do not continue selling.",
  rule_id: "objection:do-not-contact",
};

/** Hard rule: this deterministic check must run before contextual analysis. */
export function isDoNotContactRequest(text: string): boolean {
  return DO_NOT_CONTACT_PATTERN.test(text);
}
