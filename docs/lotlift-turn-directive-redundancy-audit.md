# LotLift methodology redundancy audit

This audit records the pre-implementation boundary for turning methodology from realtime background context into profile strategy. It is based on the active LotLift profile, deterministic objection rules, structured framework cards, and the response-composition prompt.

| Scenario | Current profile/candidate strategy | Relevant framework | Redundant? | Missing useful principle |
|---|---|---|---|---|
| Existing CRM | `existing-workflow-coverage` asks whether inquiries are immediately owned and forbids CRM replacement claims. | `existing-solution`: respect the current process; inspect one verified workflow gap. | **Partly.** The profile already covers neutral workflow verification and no attack. | When an after-hours gap is verified, acknowledge the current CRM, use that exact gap, and ask why it occurs instead of re-asking whether coverage exists. |
| Not interested | `first-refusal` asks one coverage question and closes after a second refusal. | `ledge-disrupt-ask`, `reflex-or-real`, `disarm-and-diagnose`: acknowledge, diagnose once, then stop. | **Yes.** The candidate and policy already encode the useful behavior. | None for the common route. |
| Send information | `information-topic` asks what the prospect needs to understand; policy forbids generic material. | `ledge-disrupt-ask`, `disarm-and-diagnose`: avoid the reflex send and ask one useful question. | **Yes.** The selected move already implements the method. | None for the common route. |
| Price after known pain | `price-next-criterion` advances past isolation; the policy already forbids pricing, ROI, and argument. | `situational-price`: tie price to verified pain and diagnose the remaining criterion. | **Mostly.** The candidate and evidence rules provide the useful constraint. | Explicitly require the verified pain when it advances the question, without repeating the prior isolation. |
| Tried before | Current unmatched wording can fall through to broad discovery; the generic guided move only asks what concerns them most. | `disarm-and-diagnose`, `reflex-or-real`: acknowledge, diagnose the concrete failure, and avoid arguing. | **No.** The generic move lacks an adoption-failure diagnostic. | Ask what made the prior attempt fail—workflow burden, ownership, or team behavior—without claiming LotLift differs. |
| Staff adoption / spying concern | The generic guided move acknowledges and asks one neutral question; the deterministic staff-adoption policy covers use/training concerns but not trust or monitoring perception. | `disarm-and-diagnose`, `reflex-or-real`: acknowledge, distinguish the actual concern, and ask one diagnostic question. | **No.** Generic clarification is safe but not specific enough. | Distinguish trust/perception from workflow burden; do not defend monitoring, invent capabilities, or ask for a meeting. |

## Prompt finding

The current composition prompt sends `relevant_methodology` as framework cards plus raw support excerpts. In the ablation this occupied roughly 1,000 tokens of a 2,100–2,700 token prompt. It is not buried, but it is optional background subordinate to profile and policy instructions. It duplicates common selected-move guidance and does not reliably alter the response.

## Implementation boundary

Common known moves should receive their guided strategy directly from editable profile data and skip methodology retrieval. Generic or underspecified moves should select at most one primary framework plus one supplemental principle, compile them locally into a TurnDirective, and send the directive—not raw excerpts—to the realtime model. Raw chunks remain for provenance, inspection, authoring support, and rare fallback only.
