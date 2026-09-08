type TurnTiming = { segmentId: string; sttFinal: number; hardRule?: number; hardRuleMs?: number; playbook?: number; modelStart?: number; modelFirstResponse?: number; modelComplete?: number; persisted?: number; visible?: number };
const turns = new Map<string, TurnTiming>();
const samples: number[] = [];
const now = () => performance.now();

export function markLotLiftTurn(segmentId: string, field: keyof Omit<TurnTiming, "segmentId">): void {
  const timing = turns.get(segmentId) ?? { segmentId, sttFinal: now() };
  timing[field] = now();
  turns.set(segmentId, timing);
  console.debug("LotLift realtime marker", { segmentId, marker: field, msFromSttFinal: Math.round(timing[field]! - timing.sttFinal) });
  if (field !== "visible") return;
  const elapsed = timing.visible! - timing.sttFinal;
  samples.push(elapsed);
  if (samples.length > 100) samples.shift();
  const ordered = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) => ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * p) - 1)] ?? 0;
  console.debug("LotLift STT FINAL → COACH VISIBLE", { ms: Math.round(elapsed), p50: Math.round(percentile(.5)), p95: Math.round(percentile(.95)), max: Math.round(ordered[ordered.length - 1] ?? 0), timing });
}

export function measureLotLiftHardRule(segmentId: string, startedAt: number): void { const timing = turns.get(segmentId) ?? { segmentId, sttFinal: startedAt }; timing.hardRule = now(); timing.hardRuleMs = timing.hardRule - startedAt; turns.set(segmentId, timing); console.debug("LotLift realtime marker", { segmentId, marker: "hardRule", durationMs: Math.round(timing.hardRuleMs) }); }

export function startLotLiftTurn(segmentId: string): void { turns.set(segmentId, { segmentId, sttFinal: now() }); console.debug("LotLift realtime marker", { segmentId, marker: "sttFinal", msFromSttFinal: 0 }); }

export function lotLiftLatencyDebug(): TurnTiming[] { return [...turns.values()]; }
