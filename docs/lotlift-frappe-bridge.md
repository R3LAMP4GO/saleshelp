# LotLift Frappe bridge contract

**Status:** intentionally disabled. No Frappe URL, token, DocType, or field mapping is stored in this project.

The local coach persists structured Call State on-device first. A future bridge may send a snapshot only after it has committed locally, never audio or a full transcript by default.

## Required configuration before enabling

- HTTPS Frappe base URL (or explicitly loopback for development)
- A dedicated, least-privilege integration account and secret supplied at runtime, never written to Parley settings or logs
- Target DocType and exact field mapping
- A user-visible consent/retention decision for each call
- Idempotency field accepting `<call-id>:<revision>`

## Payload contract

```json
{
  "call_id": "opaque-id",
  "revision": 7,
  "current_solution": "shared inbox",
  "quantified_pain": ["three paid inquiries sat overnight"],
  "authority": "general manager",
  "urgency": "before weekend campaign",
  "recurring_objections": [{"kind":"existing-solution","count":2,"resolved":false}],
  "prior_answers": [],
  "commitments": ["workflow check Tuesday"],
  "open_questions": ["Which marketplace sources are approved?"]
}
```

The sender must enforce an endpoint allowlist, HTTPS/loopback only, a short timeout, bounded retries, durable idempotent outbox entries, and a visible retry/error status. A failed sync must never block the local call or overwrite newer Call State.

## Explicit exclusions

No raw audio, full transcript, API key, Frappe secret, browser cookies, customer contact data, or unverified LLM inference belongs in the default payload.
