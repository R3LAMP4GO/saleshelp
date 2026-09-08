import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, RotateCcw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "../../lib/store";
import { newLotLiftCallState, reduceLotLiftCallState } from "../../lib/lotlift/callState";
import { classifyLotLiftTurn } from "../../lib/lotlift/coach";
import { getLotLiftLiveStatus, setLotLiftLiveStatus, subscribeLotLiftLiveStatus, type LotLiftLiveStatus } from "../../lib/lotlift/liveStatus";

type Turn = { id: number; text: string; response: { id: string; title: string; response: string; consideration: string; rule_id: string } | null };

const EXAMPLE_TURNS = [
  "I need to talk to my wife before we make a decision.",
  "Honestly, this sounds like too much money for us right now.",
];

export function LiveCallSimulator() {
  const openHome = useStore((state) => state.openHome);
  const userName = useStore((state) => state.settings.userName);
  const [line, setLine] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [callState, setCallState] = useState(() => newLotLiftCallState("lotlift-simulator"));
  const [coachState, setCoachState] = useState<LotLiftLiveStatus>(getLotLiftLiveStatus);
  useEffect(() => subscribeLotLiftLiveStatus(() => setCoachState(getLotLiftLiveStatus())), []);

  const latest = turns[turns.length - 1]?.response ?? null;

  function addProspectLine(text: string) {
    const cleaned = text.trim();
    if (!cleaned) return;
    setLotLiftLiveStatus("Thinking");
    const segment = { id: `sim-${Date.now()}`, source: "them" as const, speaker: 0, isFinal: true, startMs: 0, endMs: 0, text: cleaned };
    const coaching = classifyLotLiftTurn(segment, callState, userName);
    if (coaching) setCallState((current) => reduceLotLiftCallState(current, coaching.state));
    const response = coaching?.response ?? null;
    setTurns((current) => [...current, { id: Date.now(), text: cleaned, response }]);
    queueMicrotask(() => setLotLiftLiveStatus(response ? "Suggestion ready" : "No intervention needed"));
    setLine("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addProspectLine(line);
  }

  function loadExample() {
    let exampleState = newLotLiftCallState("lotlift-simulator");
    const exampleTurns: Turn[] = [];
    for (const [index, text] of EXAMPLE_TURNS.entries()) {
      const segment = { id: `sim-example-${index}`, source: "them" as const, speaker: 0, isFinal: true, startMs: 0, endMs: 0, text };
      const coaching = classifyLotLiftTurn(segment, exampleState, userName);
      if (coaching) exampleState = reduceLotLiftCallState(exampleState, coaching.state);
      exampleTurns.push({ id: index, text, response: coaching?.response ?? null });
    }
    setTurns(exampleTurns);
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
            <p className="max-w-2xl text-sm text-muted-foreground">Enter each prospect line. The coach retains the call and returns one approved response when it detects an objection.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={openHome}><ArrowLeft className="size-4" />Back to home</Button>
            <Button variant="outline" onClick={() => { setTurns([]); setCallState(newLotLiftCallState("lotlift-simulator")); }} disabled={turns.length === 0}><RotateCcw className="size-4" />Clear call</Button>
          </div>
        </header>

        <div className="grid min-h-0 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <section className="rounded-lg border bg-card" aria-labelledby="transcript-heading">
            <div className="border-b px-4 py-3 sm:px-5">
              <h2 id="transcript-heading" className="text-sm font-semibold">Call transcript</h2>
              <p className="mt-1 text-xs text-muted-foreground">Synthetic training only. No call audio is recorded here.</p>
            </div>
            <ol className="min-h-56 space-y-3 p-4 sm:p-5" aria-label="Prospect turns">
              {turns.length === 0 ? (
                <li className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">Start with a prospect line, or load the spouse-and-price example.</li>
              ) : turns.map((turn) => (
                <li key={turn.id} className="border-l-2 border-foreground/30 pl-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Prospect</p>
                  <p className="mt-1 text-sm leading-6">{turn.text}</p>
                </li>
              ))}
            </ol>
            <form onSubmit={submit} className="border-t p-4 sm:p-5">
              <label htmlFor="prospect-line" className="text-sm font-medium">Prospect line</label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input id="prospect-line" value={line} onChange={(event) => setLine(event.target.value)} placeholder="e.g. I need to speak with my wife first." className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" autoComplete="off" />
                <Button type="submit" className="h-10"><Send className="size-4" />Coach this line</Button>
              </div>
              <Button type="button" variant="link" className="mt-2 h-auto px-0 text-xs" onClick={loadExample}>Load spouse-and-price example</Button>
            </form>
          </section>

          <aside className="rounded-lg border bg-card" aria-labelledby="response-heading" aria-live="polite">
            <div className="border-b px-4 py-3 sm:px-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live coach</p>
              <h2 id="response-heading" className="mt-1 text-base font-semibold">{coachState}</h2>
            </div>
            <div className="space-y-5 p-4 sm:p-5">
              {latest ? <>
                <div><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Say</h3><p className="mt-2 text-lg font-medium leading-7">{latest.response}</p></div>
                <div className="border-t pt-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Goal</h3><p className="mt-2 text-sm leading-6">{latest.consideration}</p></div>
                <p className="text-xs text-muted-foreground">Source: {latest.rule_id}</p>
              </> : <div className="flex min-h-44 flex-col justify-center gap-2 text-sm text-muted-foreground"><Sparkles className="size-5" aria-hidden="true" /><p>{coachState === "Thinking" ? "Thinking…" : coachState === "Local model unavailable" ? "Local model unavailable." : coachState === "Fallback used" ? "Fallback used." : "No intervention needed."}</p></div>}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
