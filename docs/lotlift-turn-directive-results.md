# TurnDirective implementation results

## A. Redundancy audit

See [the pre-implementation audit](./lotlift-turn-directive-redundancy-audit.md). Existing CRM, first refusal, send-information, and price moves already had sufficient candidate/policy behavior. Tried-before and staff-trust concerns needed a diagnostic strategy.

## B–G. Runtime contract

`LotLiftTurnDirective` contains an objective, imperative approach, avoidances, cited call evidence, desired progression, and a one-question limit. Editable profile move strategies produce directives for known moves; the compiler uses one `disarm-and-diagnose` framework for generic novel concerns. Known CRM produces a directive that respects VinSolutions, uses verified after-hours evidence, avoids a CRM pitch, and asks one diagnostic question. Staff-trust produces a directive to acknowledge trust concern, distinguish perception from workflow burden, avoid a defense, and ask one question.

## D–E. Retrieval boundary

Known moves with a profile strategy skip methodology retrieval. Generic moves retrieve only when knowledge is available; unavailable knowledge produces the local generic clarification directive. Raw chunks remain local diagnostics/provenance and are absent from the realtime prompt.

## H–I. Quality and latency

The prior raw-book design produced 1 ON win, 1 OFF win, and 28 equivalent pairs. The final 60-response TurnDirective run produced ON average 22.10/24, OFF 22.97/24, 0 ON wins, 5 OFF wins, and 25 equivalents; p50 latency was 1444ms ON and 1510ms OFF. This run does **not** demonstrate a quality improvement. Common ON/OFF prompts are intentionally identical after retrieval is skipped, so their differences are sampling variance; novel staff-trust still needs a stronger profile-specific strategy before the design earns a quality claim.

## J. Verification

`bunx tsc --noEmit`, `bunx vitest run` (76 files, 599 tests), `bun run build`, and `cargo check --manifest-path src-tauri/Cargo.toml` passed. The final real Terra suite completed 60 validated responses and 30 blinded pairs. Existing build chunk-size and test `act(...)` warnings remain.
