import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ArrowLeft, Loader2, Mic, RotateCcw, Send, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "../../lib/store";
import { newLotLiftCallState, reduceLotLiftCallState, type CallStateEvent, type LotLiftCallState } from "../../lib/lotlift/callState";
import { classifyLotLiftTurn } from "../../lib/lotlift/coach";
import { analyzeLotLiftTurn } from "../../lib/lotlift/turnIntelligence";
import { getLotLiftLiveStatus, setLotLiftLiveStatus, subscribeLotLiftLiveStatus, type LotLiftLiveStatus } from "../../lib/lotlift/liveStatus";
import { isTauri } from "../../lib/tauriEvents";
import { sttApiKey, sttRelayUrl } from "../../lib/transcription/providers";
import { languageHintsFromSettings } from "../../lib/transcription/languageHints";
import { vocabularyTerms } from "../../lib/dictionary";
import { HOSTED_VOICE_TYPING_MAX_SECONDS } from "../../lib/limits";
import { selectLotLiftNextMove } from "../../lib/lotlift/nextMove";
import { lotLiftDecisionContextEvent } from "../../lib/lotlift/decisionContext";
import { normalizeForIntent } from "../../lib/lotlift/intentNormalization";
import { resolveSalesProfile } from "../../lib/sales/profiles";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../../../sales-profiles/lotlift/profile";
import { simulatorExecutedRepAction } from "../../lib/lotlift/simulatorRepAction";

type Turn = { id: number; source: "them" | "me"; text: string; response: { id: string; title: string; response: string; consideration: string; rule_id: string; source: string } | null };
type TrainingDiagnostic = { phase: "SCRIPTED ROUTE" | "MODEL REQUESTED" | "MODEL ACCEPTED" | "MODEL REJECTED" | "MODEL TIMEOUT" | "PROVIDER UNAVAILABLE"; provider: string; model: string; reasoning: string | null; keyConfigured: boolean; intentText?: string; intent?: string; move?: string; responseMode?: string; modelRequested: boolean; elapsedMs?: number; reason?: string };
type VoiceState = "idle" | "listening" | "finishing";
type TranscriptPayload = { id: string; source: string; text: string; is_final: boolean };
type VoiceErrorPayload = { code: string; message: string };

const EXAMPLE_TURNS = [
  "I need to talk to my wife before we make a decision.",
  "Honestly, this sounds like too much money for us right now.",
];
const VOICE_SOURCE = "voice-typing";
const FINAL_FLUSH_FALLBACK_MS = 1_800;

function transcriptFrom(finals: Map<string, string>, interim: string): string {
  return [...finals.values(), interim].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function LiveCallSimulator() {
  const openHome = useStore((state) => state.openHome);
  const userName = useStore((state) => state.settings.userName);
  const settings = useStore((state) => state.settings);
  const resolvedProfile = useMemo(() => resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE), []);
  const [line, setLine] = useState("");
  const [repLine, setRepLine] = useState("");
  const [mode, setMode] = useState<"deterministic" | "local-ai">("deterministic");
  const [trainingDiagnostic, setTrainingDiagnostic] = useState<TrainingDiagnostic | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnsRef = useRef<Turn[]>([]);
  const callStateRef = useRef<LotLiftCallState>(newLotLiftCallState("lotlift-simulator"));
  const [, setCallState] = useState(() => callStateRef.current);
  const [coachState, setCoachState] = useState<LotLiftLiveStatus>(getLotLiftLiveStatus);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [spokenText, setSpokenText] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceStateRef = useRef<VoiceState>("idle");
  const finalSegmentsRef = useRef(new Map<string, string>());
  const interimRef = useRef("");
  const spokenTextRef = useRef("");
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const submittedVoiceTurnRef = useRef(false);
  const localSelectionAbortRef = useRef<AbortController | null>(null);
  useEffect(() => subscribeLotLiftLiveStatus(() => setCoachState(getLotLiftLiveStatus())), []);

  const latest = [...turns].reverse().find((turn) => turn.response)?.response ?? null;
  const realtimeProvider = settings.llmProviders.realtime;
  const realtimeModel = settings.models[realtimeProvider]?.realtime ?? "unconfigured";
  const realtimeKeyConfigured = realtimeProvider === "ollama" || Boolean((settings as unknown as Record<string, unknown>)[`${realtimeProvider}ApiKey`]);
  const diagnosticBase = { provider: realtimeProvider, model: realtimeModel, reasoning: settings.reasoningEffort.realtime, keyConfigured: realtimeKeyConfigured };

  function setVoicePhase(next: VoiceState) {
    voiceStateRef.current = next;
    setVoiceState(next);
  }

  function clearFinishTimer() {
    if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
    finishTimerRef.current = undefined;
  }

  function applyStateEvents(events: readonly CallStateEvent[]): LotLiftCallState {
    if (!events.length) return callStateRef.current;
    const next = events.reduce(reduceLotLiftCallState, callStateRef.current);
    callStateRef.current = next;
    setCallState(next);
    return next;
  }

  function appendTurn(next: Turn) {
    turnsRef.current = [...turnsRef.current, next];
    setTurns(turnsRef.current);
  }

  function addRepLine(text: string, executedMoveId?: string) {
    const cleaned = text.trim();
    if (!cleaned) return;
    const id = Date.now();
    appendTurn({ id, source: "me", text: cleaned, response: null });
    if (executedMoveId) {
      const move = resolvedProfile.behavior.moves.find((candidate) => candidate.id === executedMoveId);
      applyStateEvents(simulatorExecutedRepAction(callStateRef.current, resolvedProfile, `sim-${id}`, move));
    }
    setRepLine("");
  }

  async function addProspectLine(text: string) {
    const cleaned = text.trim();
    if (!cleaned) return;
    const startedAt = performance.now();
    localSelectionAbortRef.current?.abort();
    localSelectionAbortRef.current = null;
    setLotLiftLiveStatus("Thinking");
    const id = Date.now();
    const segment = { id: `sim-${id}`, source: "them" as const, speaker: 0, isFinal: true, startMs: 0, endMs: 0, text: cleaned };
    const conversation = [...turnsRef.current.map((turn) => ({ ...segment, id: `sim-${turn.id}`, source: turn.source, speaker: turn.source === "me" ? 1 : 0, text: turn.text })), segment];
    const decisionEvent = lotLiftDecisionContextEvent(segment);
    if (decisionEvent) applyStateEvents([decisionEvent]);
    const coaching = classifyLotLiftTurn(segment, callStateRef.current, userName, conversation);
    const fallbackMove = selectLotLiftNextMove({ state: callStateRef.current, turn: segment, conversation, approvedRepIdentity: userName, resolvedProfile });
    if (coaching) {
      const progress = coaching.state.type === "coaching-progress"
        ? []
        : [{ type: "coaching-progress" as const, move_id: coaching.response.id, substantive_refusal: coaching.response.id === "D1" || coaching.response.id === "N1" }];
      applyStateEvents([coaching.state, ...progress]);
    }
    applyStateEvents(fallbackMove.state_events);
    const response: NonNullable<Turn["response"]> = coaching
      ? { ...coaching.response, source: "approved-card" }
      : { id: fallbackMove.id, title: fallbackMove.title, response: fallbackMove.response, consideration: fallbackMove.goal, rule_id: fallbackMove.id, source: fallbackMove.source };
    appendTurn({ id, source: "them", text: cleaned, response });
    const intent = fallbackMove.id === "O2" ? "identity" : fallbackMove.id === "O3" ? "purpose" : undefined;
    setTrainingDiagnostic({ phase: fallbackMove.response_mode === "compose" ? "MODEL REQUESTED" : "SCRIPTED ROUTE", ...diagnosticBase, intentText: normalizeForIntent(cleaned), intent, move: fallbackMove.id, responseMode: fallbackMove.response_mode, modelRequested: false, elapsedMs: performance.now() - startedAt });
    setLotLiftLiveStatus("Suggestion ready");
    setLine("");

    // Hard stops exit above; approved cards remain the constrained fallback and composition objective.
    if (mode !== "local-ai" || fallbackMove.source !== "approved-move" || fallbackMove.response_mode !== "compose") return;
    const controller = new AbortController();
    localSelectionAbortRef.current = controller;
    const modelStartedAt = performance.now();
    setTrainingDiagnostic({ phase: "MODEL REQUESTED", ...diagnosticBase, intentText: normalizeForIntent(cleaned), move: fallbackMove.id, responseMode: fallbackMove.response_mode, modelRequested: true });
    try {
      const result = await analyzeLotLiftTurn({ state: callStateRef.current, turn: segment, conversation, settings, signal: controller.signal, resolvedProfile });
      if (localSelectionAbortRef.current !== controller || result.fallback_reason === "cancelled") return;
      if (result.state_events.length) applyStateEvents(result.state_events);
      if (result.source === "model" && result.selected_move && result.spoken_response) {
        const selected = result.selected_move;
        const updated = { id: selected.id, title: selected.title, response: result.spoken_response, consideration: selected.goal, rule_id: selected.id, source: "model-composed guarded response" };
        turnsRef.current = turnsRef.current.map((turn) => turn.id === id ? { ...turn, response: updated } : turn);
        setTurns(turnsRef.current);
        setTrainingDiagnostic({ phase: "MODEL ACCEPTED", ...diagnosticBase, intentText: normalizeForIntent(cleaned), move: selected.id, responseMode: selected.response_mode, modelRequested: true, elapsedMs: performance.now() - modelStartedAt });
        setLotLiftLiveStatus("Suggestion ready");
      } else if (result.source === "fallback" && result.selected_move) {
        const selected = result.selected_move;
        const updated = { id: selected.id, title: selected.title, response: selected.response, consideration: selected.goal, rule_id: selected.id, source: "approved scripted response" };
        turnsRef.current = turnsRef.current.map((turn) => turn.id === id ? { ...turn, response: updated } : turn);
        setTurns(turnsRef.current);
        const timeout = result.fallback_reason === "timeout";
        setTrainingDiagnostic({ phase: timeout ? "MODEL TIMEOUT" : "MODEL REJECTED", ...diagnosticBase, intentText: normalizeForIntent(cleaned), move: selected.id, responseMode: selected.response_mode, modelRequested: true, elapsedMs: performance.now() - modelStartedAt, reason: result.fallback_reason });
        // Keep the already-visible approved script usable; diagnostics retain the miss reason.
        setLotLiftLiveStatus("Suggestion ready");
      }
    } catch {
      setTrainingDiagnostic({ phase: realtimeKeyConfigured ? "PROVIDER UNAVAILABLE" : "MODEL REJECTED", ...diagnosticBase, intentText: normalizeForIntent(cleaned), move: fallbackMove.id, responseMode: fallbackMove.response_mode, modelRequested: true, elapsedMs: performance.now() - modelStartedAt, reason: realtimeKeyConfigured ? "provider-error" : "missing-key" });
    } finally {
      if (localSelectionAbortRef.current === controller) localSelectionAbortRef.current = null;
    }
  }

  function submitSpokenTurn() {
    if (submittedVoiceTurnRef.current) return;
    submittedVoiceTurnRef.current = true;
    clearFinishTimer();
    const text = spokenTextRef.current.trim();
    setVoicePhase("idle");
    if (text) void addProspectLine(text);
    else setVoiceError("We did not hear a completed prospect line. Try again or type it below.");
  }

  function scheduleSpokenTurn(delayMs: number) {
    clearFinishTimer();
    finishTimerRef.current = setTimeout(submitSpokenTurn, delayMs);
  }

  useEffect(() => {
    if (!isTauri()) return;
    const unsubs: UnlistenFn[] = [];
    let cancelled = false;
    const track = (promise: Promise<UnlistenFn>) => {
      promise.then((unlisten) => {
        if (cancelled) unlisten();
        else unsubs.push(unlisten);
      });
    };

    track(listen<TranscriptPayload>("transcript://segment", ({ payload }) => {
      if (payload.source !== VOICE_SOURCE || voiceStateRef.current === "idle") return;
      if (payload.is_final) {
        finalSegmentsRef.current.set(payload.id, payload.text);
        interimRef.current = "";
      } else {
        interimRef.current = payload.text;
      }
      const next = transcriptFrom(finalSegmentsRef.current, interimRef.current);
      spokenTextRef.current = next;
      setSpokenText(next);
      if (voiceStateRef.current === "finishing" && payload.is_final) scheduleSpokenTurn(350);
    }));
    track(listen<{ source: string }>("stt://closed", ({ payload }) => {
      if (payload.source === VOICE_SOURCE && voiceStateRef.current === "finishing") scheduleSpokenTurn(150);
    }));
    track(listen<VoiceErrorPayload>("voicetyping://error", ({ payload }) => {
      if (voiceStateRef.current === "idle") return;
      clearFinishTimer();
      setVoicePhase("idle");
      setVoiceError(payload.code === "key" ? "Transcription access was rejected. Update the provider key in Settings." : payload.message || "Voice transcription could not start. Try again.");
    }));

    return () => {
      cancelled = true;
      unsubs.forEach((unlisten) => unlisten());
      localSelectionAbortRef.current?.abort();
      localSelectionAbortRef.current = null;
      clearFinishTimer();
      if (voiceStateRef.current !== "idle") void invoke("stop_voice_typing");
    };
  }, []);

  async function startSpeaking() {
    if (!isTauri()) {
      setVoiceError("Speaking practice is available in the desktop app. You can still type a prospect line here.");
      return;
    }
    const provider = settings.transcriptionProvider;
    const apiKey = sttApiKey(settings, provider);
    if (!apiKey.trim()) {
      setVoiceError("Choose and configure a transcription provider in Settings before speaking.");
      return;
    }
    clearFinishTimer();
    finalSegmentsRef.current.clear();
    interimRef.current = "";
    spokenTextRef.current = "";
    submittedVoiceTurnRef.current = false;
    setSpokenText("");
    setVoiceError(null);
    setVoicePhase("listening");
    try {
      await invoke("start_voice_typing", {
        provider,
        apiKey,
        languageHints: languageHintsFromSettings(settings),
        inputDevice: settings.inputDevice ?? null,
        relayUrl: sttRelayUrl(provider, "voice_typing"),
        maxDurationSecs: provider === "parley" ? HOSTED_VOICE_TYPING_MAX_SECONDS : null,
        vocabulary: vocabularyTerms(),
      });
    } catch (error) {
      setVoicePhase("idle");
      setVoiceError(`Could not start the microphone: ${String(error)}`);
    }
  }

  async function finishSpeaking() {
    if (voiceStateRef.current !== "listening") return;
    setVoicePhase("finishing");
    scheduleSpokenTurn(FINAL_FLUSH_FALLBACK_MS);
    try {
      await invoke("stop_voice_typing");
    } catch (error) {
      clearFinishTimer();
      setVoicePhase("idle");
      setVoiceError(`Could not finish the microphone session: ${String(error)}`);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void addProspectLine(line);
  }

  function clearCall() {
    submittedVoiceTurnRef.current = true;
    localSelectionAbortRef.current?.abort();
    localSelectionAbortRef.current = null;
    clearFinishTimer();
    if (voiceStateRef.current !== "idle") {
      setVoicePhase("idle");
      void invoke("stop_voice_typing");
    }
    turnsRef.current = [];
    setTurns([]);
    callStateRef.current = newLotLiftCallState("lotlift-simulator");
    setCallState(callStateRef.current);
    setSpokenText("");
    setVoiceError(null);
  }

  function loadExample() {
    let exampleState = newLotLiftCallState("lotlift-simulator");
    const exampleTurns: Turn[] = [];
    for (const [index, text] of EXAMPLE_TURNS.entries()) {
      const segment = { id: `sim-example-${index}`, source: "them" as const, speaker: 0, isFinal: true, startMs: 0, endMs: 0, text };
      const decisionEvent = lotLiftDecisionContextEvent(segment);
      if (decisionEvent) exampleState = reduceLotLiftCallState(exampleState, decisionEvent);
      const coaching = classifyLotLiftTurn(segment, exampleState, userName);
      if (coaching) exampleState = reduceLotLiftCallState(exampleState, coaching.state);
      const fallbackMove = selectLotLiftNextMove({ state: exampleState, turn: segment, conversation: [...exampleTurns.map((turn) => ({ ...segment, id: `sim-${turn.id}`, text: turn.text })), segment] });
      if (!coaching) exampleState = fallbackMove.state_events.reduce(reduceLotLiftCallState, exampleState);
      exampleTurns.push({ id: index, source: "them", text, response: coaching
        ? { ...coaching.response, source: "approved-card" }
        : { id: fallbackMove.id, title: fallbackMove.title, response: fallbackMove.response, consideration: fallbackMove.goal, rule_id: fallbackMove.id, source: fallbackMove.source } });
    }
    turnsRef.current = exampleTurns;
    setTurns(exampleTurns);
    callStateRef.current = exampleState;
    setCallState(exampleState);
    setLotLiftLiveStatus(exampleTurns[exampleTurns.length - 1]?.response ? "Suggestion ready" : "No intervention needed");
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto" aria-labelledby="simulator-title">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-10">
        <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">LotLift training</p>
            <h1 id="simulator-title" className="text-xl font-semibold tracking-tight">Live Call Simulator</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">Speak as the prospect, then finish your turn. The coach keeps the full call context and returns the approved next response.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 text-sm"><span className="sr-only">Coach mode</span><select value={mode} onChange={(event) => setMode(event.target.value as "deterministic" | "local-ai")} className="h-9 rounded-md border bg-background px-2"><option value="deterministic">Approved cards</option><option value="local-ai">Local AI</option></select></label>
            <Button variant="ghost" onClick={openHome}><ArrowLeft className="size-4" />Back to home</Button>
            <Button variant="outline" onClick={clearCall} disabled={turns.length === 0}><RotateCcw className="size-4" />Clear call</Button>
          </div>
        </header>

        <div className="grid min-h-0 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <section className="rounded-lg border bg-card" aria-labelledby="transcript-heading">
            <div className="border-b px-4 py-3 sm:px-5">
              <h2 id="transcript-heading" className="text-sm font-semibold">Call transcript</h2>
              <p className="mt-1 text-xs text-muted-foreground">Synthetic training only. Spoken turns are transcribed, not recorded as call audio.</p>
            </div>
            <ol className="min-h-56 space-y-3 p-4 sm:p-5" aria-label="Prospect turns">
              {turns.length === 0 ? (
                <li className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">Speak or type a prospect line, or load the spouse-and-price example.</li>
              ) : turns.map((turn) => (
                <li key={turn.id} className="border-l-2 border-foreground/30 pl-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{turn.source === "me" ? "Rep (actual speech)" : "Prospect"}</p>
                  <p className="mt-1 text-sm leading-6">{turn.text}</p>
                </li>
              ))}
            </ol>
            <div className="border-t p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-medium">Speak as the prospect</h3>
                  <p id="voice-practice-help" className="mt-1 text-xs text-muted-foreground">Start, speak one prospect turn, then finish to receive the next response.</p>
                </div>
                {voiceState === "listening" ? (
                  <Button type="button" variant="destructive" className="min-h-11" onClick={() => void finishSpeaking()} aria-describedby="voice-practice-help"><Square className="size-4" />Finish turn</Button>
                ) : (
                  <Button type="button" className="min-h-11" onClick={() => void startSpeaking()} disabled={voiceState === "finishing"} aria-describedby="voice-practice-help"><Mic className="size-4" />Start speaking</Button>
                )}
              </div>
              <div className="mt-3 min-h-11 rounded-md border bg-background px-3 py-2 text-sm" aria-live="off" aria-label="Current spoken prospect line">
                {voiceState === "listening" ? (spokenText || "Listening for your prospect line…") : voiceState === "finishing" ? (spokenText || "Finishing your prospect line…") : "Your spoken prospect line will appear here."}
              </div>
              {voiceState === "finishing" && <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="size-3 animate-spin" aria-hidden="true" />Preparing the response…</p>}
              {voiceError && <p className="mt-2 text-xs text-destructive" role="alert">{voiceError}</p>}
            </div>
            <form onSubmit={submit} className="border-t p-4 sm:p-5">
              <label htmlFor="prospect-line" className="text-sm font-medium">Prospect line</label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input id="prospect-line" value={line} onChange={(event) => setLine(event.target.value)} placeholder="e.g. I need to speak with my wife first." className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" autoComplete="off" />
                <Button type="submit" className="h-10"><Send className="size-4" />Coach this line</Button>
              </div>
              <Button type="button" variant="link" className="mt-2 h-auto px-0 text-xs" onClick={loadExample}>Load spouse-and-price example</Button>
            </form>
            <form onSubmit={(event) => { event.preventDefault(); addRepLine(repLine); }} className="border-t p-4 sm:p-5">
              <label htmlFor="rep-line" className="text-sm font-medium">Actual rep speech</label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input id="rep-line" value={repLine} onChange={(event) => setRepLine(event.target.value)} placeholder="Type what the rep actually said" className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm" autoComplete="off" />
                <Button type="submit" className="h-10" variant="outline">Log rep speech</Button>
              </div>
            </form>
          </section>

          <aside className="rounded-lg border bg-card" aria-labelledby="response-heading" aria-live="polite">
            <div className="border-b px-4 py-3 sm:px-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live coach</p>
              <h2 id="response-heading" className="mt-1 text-base font-semibold">{coachState}</h2>
            </div>
            <div className="space-y-5 p-4 sm:p-5">
              {trainingDiagnostic && <p className="rounded-md border p-2 text-xs text-muted-foreground" data-testid="training-diagnostic">{trainingDiagnostic.phase} · profile=lotlift-cold-outbound · normalized={trainingDiagnostic.intentText ?? "n/a"} · intent={trainingDiagnostic.intent ?? "contextual"} · move={trainingDiagnostic.move ?? "n/a"} · response_mode={trainingDiagnostic.responseMode ?? "n/a"} · model_requested={trainingDiagnostic.modelRequested ? "true" : "false"}{trainingDiagnostic.elapsedMs != null ? ` · ${Math.round(trainingDiagnostic.elapsedMs)}ms` : ""}{trainingDiagnostic.reason ? ` · ${trainingDiagnostic.reason}` : ""}</p>}
              {latest ? <>
                <div><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Say this now</h3><p className="mt-2 text-lg font-medium leading-7">{latest.response}</p><Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => addRepLine(latest.response, latest.id)}>I said this</Button></div>
                <div className="border-t pt-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Goal</h3><p className="mt-2 text-sm leading-6">{latest.consideration}</p></div>
                <p className="text-xs text-muted-foreground">Source: {latest.source} · {latest.rule_id}</p>
              </> : <div className="flex min-h-44 flex-col justify-center gap-2 text-sm text-muted-foreground"><Sparkles className="size-5" aria-hidden="true" /><p>{coachState === "Thinking" ? "Thinking…" : coachState === "Local model unavailable" ? "Local model unavailable." : coachState === "Fallback used" ? "Fallback used." : "Speak or enter a prospect line to receive coaching."}</p></div>}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
