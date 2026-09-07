# Live Call Simulator design notes

## Design read

- **Surface:** focused desktop coaching tool that collapses to a single-column mobile practice flow.
- **Audience:** a LotLift rep rehearsing high-stakes cold-call objections.
- **Job:** make the next approved response visible immediately, without losing earlier prospect context.
- **Risk:** an invented reply or forgotten decision-maker context harms the call, so the response is deterministic and the context shown is traceable.

## Direction

The existing Parley shell remains intact. The simulator uses the app’s neutral card, border, typography, Button, and Lucide patterns. A shared max-width rail holds a transcript first and a single-response panel second; mobile preserves that reading order by stacking the response after the transcript. A plain left border identifies prospect turns and the context that informed the current response. No decorative AI imagery, motion, or semantic tint is introduced.

## States and accessibility

- Empty state explains the single next action and offers a clearly labelled example.
- The prospect field has a visible label, keyboard submit, and visible keyboard focus.
- The response region uses polite live announcement only after a completed objection, not every keystroke.
- Clear Call is disabled while empty; Back returns through the existing app route.
- Buttons use native controls and visible text labels; the layout reflows to one column below `lg`.

## Verification scope

Desktop and narrow browser screenshots cover the primary simulator flow. Automated tests cover price, do-not-call, and spouse-context retrieval. Manual screen-reader, forced-colors, 200% text, and native Tauri-window verification remain unverified.
