import { lotLiftPlaybookRule, type LotLiftPlaybookRuleId } from "./playbook";

export interface ApprovedLotLiftResponse {
  id: string;
  title: string;
  response: string;
  consideration: string;
  rule_id: LotLiftPlaybookRuleId;
}

type ObjectionRoute = {
  id: string;
  rule_id: Exclude<LotLiftPlaybookRuleId, "objection:do-not-contact">;
  pattern: RegExp;
};

const ROUTES: ObjectionRoute[] = [
  { id: "direct-integration", rule_id: "objection:direct-integration", pattern: /\b(crm|dms).{0,24}\b(integration|integrate)\b|\bdirect (?:crm|dms)\b/i },
  { id: "send-information", rule_id: "objection:send-information", pattern: /\b(send|email).{0,24}\b(info|information|details|deck)\b/i },
  { id: "call-later", rule_id: "objection:call-later", pattern: /\b(call (?:me )?later|try (?:me )?later|another time)\b/i },
  { id: "need-to-think", rule_id: "objection:need-to-think", pattern: /\b(need to think|think about it|sleep on it)\b/i },
  { id: "spouse-partner", rule_id: "objection:spouse-partner", pattern: /\b(wife|husband|spouse|partner)\b/i },
  { id: "busy", rule_id: "objection:busy", pattern: /\b(busy|in the middle of|bad time)\b/i },
  { id: "competitor", rule_id: "objection:competitor", pattern: /\b(competitor|already use|using another|other provider)\b/i },
  { id: "price", rule_id: "objection:no-budget", pattern: /\b(too expensive|too much money|no budget|can'?t afford|costs? too much)\b/i },
  { id: "not-interested", rule_id: "objection:not-interested", pattern: /\b(not interested|not a priority|no thanks)\b/i },
  { id: "existing-solution", rule_id: "objection:existing-crm", pattern: /\b(crm|bdc|internet department|salespeople handle|already handle)\b/i },
];

function responseFor(route: ObjectionRoute): ApprovedLotLiftResponse {
  const rule = lotLiftPlaybookRule(route.rule_id);
  const response = rule.good_examples[0];
  if (!response) throw new Error(`LotLift playbook rule ${route.rule_id} has no approved example.`);
  return { id: route.id, title: rule.intent, response, consideration: rule.objective, rule_id: route.rule_id };
}

/** Deterministic route matching; all approved language is retrieved from the Markdown playbook. */
export function retrieveApprovedLotLiftResponse(text: string, priorProspectLines: readonly string[] = []): ApprovedLotLiftResponse | null {
  const route = ROUTES.find(({ pattern }) => pattern.test(text));
  if (!route) return null;
  const hasSpouseContext = priorProspectLines.some((line) => /\b(wife|husband|spouse|partner)\b/i.test(line));
  return route.rule_id === "objection:no-budget" && hasSpouseContext
    ? responseFor({ id: "price-with-spouse", rule_id: "objection:spouse-partner", pattern: /./ })
    : responseFor(route);
}
