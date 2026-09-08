# Local LotLift Frappe cold-call bridge

**Status:** local-only smoke-test integration. It creates fictional CRM records in `crm.localhost`; it does not call, email, webhook, queue, or schedule outreach.

## Fixed endpoint and payload

The desktop posts exactly one wrapper to:

```text
POST http://crm.localhost:8000/api/method/shared_crm.api.sync_lotlift_cold_call
```

HTTP is accepted only for loopback addresses, including `.localhost`; other HTTP hosts are rejected. HTTPS remains required elsewhere.

```json
{
  "payload": {
    "idempotency_key": "fictional-call:1:final_analysis",
    "outcome": "qualified",
    "first_name": "LotLift Fictional",
    "email": "lotlift-fictional@example.com",
    "organization": "LotLift Fictional Motors",
    "mobile_no": "+15550100",
    "job_title": "Test Manager",
    "summary": "Fictional verified cold-call summary."
  }
}
```

`outcome` is `qualified`, `no_follow_up`, or `do_not_contact`. Only `qualified` creates a linked CRM Task. The server rejects unknown fields, unverified-looking or oversized values, invalid email/idempotency values, and non-`Sales User` callers.

The response contains only `lead_name`, optional `task_name`, and `action_state`. A unique private **LotLift Sync** row owns the idempotency key, lead, task, and summary; retries return that same result.

## Local smoke-test account

1. Create a dedicated local user with **Sales User** only.
2. Create one API token for that user; do not print, commit, log, or put its secret in `.env`.
3. Save the token secret at runtime through `save_lotlift_frappe_credential` using a descriptive keychain reference such as `lotlift-local-smoke`.
4. Use that reference with `FrappeConfig { base_url: "http://crm.localhost:8000", auth_method: "token", credential_reference: "lotlift-local-smoke" }`.

The outbox stores the reference, never the token. It uses a five-second timeout, bounded retries, and an idempotency key derived from call ID and revision.

## Safety boundary

Use only fictional `example.com` records with a unique `LotLift` prefix. The endpoint has no email, dialer, webhook, queue, scheduler, or automation import/call. It updates native **CRM Lead** fields (`first_name`, organization, email, mobile number, job title, source, status), adds a local verified-summary comment, and creates a native **CRM Task** only when the payload says `qualified`.

No audio, full transcript, browser cookies, Frappe token, raw contact data, or unverified model output belongs in this payload. Do not connect this local smoke test to real people or outbound automation.
