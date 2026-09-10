import { lotLiftPlaybookRule, type LotLiftPlaybookRuleId } from "./playbook";
import type { LotLiftPolicyTacticId } from "./policyPack";

export interface ApprovedLotLiftResponse {
  id: string;
  title: string;
  response: string;
  consideration: string;
  rule_id: LotLiftPlaybookRuleId;
  tactic_id: LotLiftPolicyTacticId;
}

type ObjectionRouteId = "direct-integration" | "send-information" | "call-later" | "need-to-think" | "spouse-partner" | "busy" | "competitor" | "price" | "not-interested" | "existing-solution" | "source-volume" | "team-size" | "contract" | "previous-caller" | "marketplace-coverage" | "ai-automation" | "data-security" | "provider-authorization" | "staff-adoption" | "build-it" | "comparison" | "trial" | "roi" | "new-company" | "status-quo";

type ObjectionRoute = {
  id: ObjectionRouteId;
  rule_id: Exclude<LotLiftPlaybookRuleId, "objection:do-not-contact">;
  pattern: RegExp;
};

export const LOTLIFT_OBJECTION_TACTICS: Record<ObjectionRouteId | "price-with-spouse", LotLiftPolicyTacticId> = {
  "direct-integration": "truthful-limitation",
  "send-information": "consented-follow-up",
  "call-later": "consented-follow-up",
  "need-to-think": "decision-criteria",
  "spouse-partner": "decision-criteria",
  busy: "consented-follow-up",
  competitor: "solution-verification",
  price: "concern-isolation",
  "price-with-spouse": "decision-criteria",
  "not-interested": "permission-and-route",
  "existing-solution": "solution-verification",
  "source-volume": "workflow-discovery", "team-size": "workflow-discovery", "contract": "consented-follow-up", "previous-caller": "consented-follow-up", "marketplace-coverage": "truthful-limitation", "ai-automation": "truthful-limitation", "data-security": "truthful-limitation", "provider-authorization": "truthful-limitation", "staff-adoption": "decision-criteria", "build-it": "decision-criteria", "comparison": "solution-verification", "trial": "decision-criteria", "roi": "concern-isolation", "new-company": "decision-criteria", "status-quo": "impact-clarification",
};

const ROUTES: ObjectionRoute[] = [
  { id: "direct-integration", rule_id: "objection:direct-integration", pattern: /\b(crm|dms).{0,24}\b(integration|integrate)\b|\bdirect (?:crm|dms)\b/i },
  { id: "send-information", rule_id: "objection:send-information", pattern: /\b(send|email)(?:\s+(?:me|us))?(?:\s+(?:some|more))?(?:\s+(?:info(?:rmation)?|details|a deck|material))?\b/i },
  { id: "call-later", rule_id: "objection:call-later", pattern: /\b(call|try|reach out) (?:me )?(?:back |again )?(?:later|another time)|\bcall back|\banother time\b/i },
  { id: "need-to-think", rule_id: "objection:need-to-think", pattern: /\b(need to think|think (?:about|over) it|sleep on it)\b/i },
  { id: "spouse-partner", rule_id: "objection:spouse-partner", pattern: /\b(wife|husband|spouse|partner)\b/i },
  { id: "busy", rule_id: "objection:busy", pattern: /\b(busy|in the middle of|in a meeting|bad time|(do not|don'?t) have time|no time)\b/i },
  { id: "competitor", rule_id: "objection:competitor", pattern: /\b(competitor|comparing (?:competitors|options)|already use|(?:use|using) another|other provider)\b/i },
  { id: "price", rule_id: "objection:no-budget", pattern: /\b(too expensive|too much money|no budget|can'?t afford|costs? too much)\b/i },
  { id: "not-interested", rule_id: "objection:not-interested", pattern: /\b(not\s+(?:(?:really|that)\s+)?(?:(?:the\s+)?most\s+)?interested|not\s+(?:a\s+)?priority|no\s+thanks)\b/i },
  { id: "provider-authorization", rule_id: "objection:provider-authorization", pattern: /\b(provider|source).{0,36}\b(?:forbid|forbidden|not authori[sz]ed|won'?t allow)\b/i },
  { id: "direct-integration", rule_id: "objection:direct-integration", pattern: /\b(crm|dms).{0,24}\b(integration|integrate)\b|\bdirect (?:crm|dms)\b/i },
  { id: "marketplace-coverage", rule_id: "objection:marketplace-coverage", pattern: /\b(?:every|all)\s+(?:marketplace|source)s?\b|\b(?:support|cover).{0,20}\b(?:marketplace|source)s?\b/i },
  { id: "ai-automation", rule_id: "objection:ai-automation", pattern: /\b(?:ai|artificial intelligence|automated?|auto[- ]?send)\b/i },
  { id: "data-security", rule_id: "objection:data-security", pattern: /\b(?:security|data (?:access|processing|retention)|permissions?|compliance)\b/i },
  { id: "send-information", rule_id: "objection:send-information", pattern: /\b(send|email)(?:\s+(?:me|us))?(?:\s+(?:some|more))?(?:\s+(?:info(?:rmation)?|details|a deck|material))?\b/i },
  { id: "call-later", rule_id: "objection:call-later", pattern: /\b(call|try|reach out) (?:me )?(?:back |again )?(?:later|another time)|\bcall back|\banother time\b/i },
  { id: "busy", rule_id: "objection:busy", pattern: /\b(busy|in the middle of|in a meeting|bad time|(do not|don'?t) have time|no time)\b/i },
  { id: "contract", rule_id: "objection:contract", pattern: /\b(?:contract|agreement|renewal|locked in)\b/i },
  { id: "previous-caller", rule_id: "objection:previous-caller", pattern: /\b(?:already (?:called|spoke|talked)|someone (?:already )?called|heard this before)\b/i },
  { id: "need-to-think", rule_id: "objection:need-to-think", pattern: /\b(need to think|think (?:about|over) it|sleep on it)\b/i },
  { id: "spouse-partner", rule_id: "objection:spouse-partner", pattern: /\b(wife|husband|spouse|partner|co-?owner)\b/i },
  { id: "trial", rule_id: "objection:trial", pattern: /\b(?:free )?(?:trial|pilot)\b/i },
  { id: "roi", rule_id: "objection:roi", pattern: /\b(?:roi|return on investment|guarantee(?:d)? (?:results?|return))\b/i },
  { id: "new-company", rule_id: "objection:new-company", pattern: /\b(?:too new|new company|early[- ]stage|been around)\b/i },
  { id: "build-it", rule_id: "objection:build-it", pattern: /\b(?:build|built|handle).{0,24}\b(?:ourselves|internally|in[- ]?house)\b/i },
  { id: "staff-adoption", rule_id: "objection:staff-adoption", pattern: /\b(?:staff|team|salespeople).{0,30}\b(?:won'?t use|adoption|training|use it)\b/i },
  { id: "comparison", rule_id: "objection:comparison", pattern: /\b(?:comparing|compare|alternatives?|options?)\b/i },
  { id: "competitor", rule_id: "objection:competitor", pattern: /\b(competitor|already use|using another|other provider)\b/i },
  { id: "price", rule_id: "objection:no-budget", pattern: /\b(too expensive|too much money|no budget|can'?t afford|costs? too much)\b/i },
  { id: "not-interested", rule_id: "objection:not-interested", pattern: /\b(not\s+(?:(?:really|that)\s+)?(?:(?:the\s+)?most\s+)?interested|not\s+(?:a\s+)?priority|no\s+thanks)\b/i },
  { id: "status-quo", rule_id: "objection:status-quo", pattern: /\b(?:happy with|working fine|good enough|no need to change)\b/i },
  { id: "source-volume", rule_id: "objection:source-volume", pattern: /\b(?:no|zero|low|not enough).{0,20}\b(?:online|marketplace|inquir(?:y|ies)|leads?)\b/i },
  { id: "team-size", rule_id: "objection:team-size", pattern: /\b(?:too small|small team|only \d+ (?:of us|people))\b/i },
  { id: "existing-solution", rule_id: "objection:existing-crm", pattern: /\b(crm|bdc|internet department|salespeople handle|already handle)\b/i },
];

function responseFor(route: ObjectionRoute): ApprovedLotLiftResponse {
  const rule = lotLiftPlaybookRule(route.rule_id);
  const response = rule.good_examples[0];
  if (!response) throw new Error(`LotLift playbook rule ${route.rule_id} has no approved example.`);
  return { id: route.id, title: rule.intent, response, consideration: rule.objective, rule_id: route.rule_id, tactic_id: LOTLIFT_OBJECTION_TACTICS[route.id] };
}

/** Deterministic route matching; all approved language is retrieved from the Markdown playbook. */
export function retrieveApprovedLotLiftResponse(text: string, priorProspectLines: readonly string[] = []): ApprovedLotLiftResponse | null {
  const route = ROUTES.find(({ pattern }) => pattern.test(text));
  if (!route) return null;
  const hasSpouseContext = priorProspectLines.some((line) => /\b(wife|husband|spouse|partner)\b/i.test(line));
  return route.rule_id === "objection:no-budget" && hasSpouseContext
    ? { ...responseFor({ id: "spouse-partner", rule_id: "objection:spouse-partner", pattern: /./ }), id: "price-with-spouse", tactic_id: LOTLIFT_OBJECTION_TACTICS["price-with-spouse"] }
    : responseFor(route);
}
