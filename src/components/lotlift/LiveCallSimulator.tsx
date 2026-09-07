import { FormEvent, useMemo, useState } from "react";
import { ArrowLeft, RotateCcw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "../../lib/store";
import { retrieveApprovedLotLiftResponse, type ApprovedLotLiftResponse } from "../../lib/lotlift/objections";

type Turn = { id: number; text: string; response: ApprovedLotLiftResponse | null };

const EXAMPLE_TURNS = [
  "I need to talk to my wife before we make a decision.",
  "Honestly, this sounds like too much money for us right now.",
];

export function LiveCallSimulator() {
  const openHome = useStore((state) => state.openHome);
  const [line, setLine] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);

  const latest = turns[turns.length - 1]?.response ?? null;
  const context = useMemo(() => turns.slice(0, -1).map((turn) => turn.text), [turns]);

  function addProspectLine(text: string) {
    const cleaned = text.trim();
    if (!cleaned) return;
    const priorLines = turns.map((turn) => turn.text);
    setTurns((current) => [...current, { id: Date.now(), text: cleaned, response: retrieveApprovedLotLiftResponse(cleaned, priorLines) }]);
    setLine("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addProspectLine(line);
  }

  function loadExample() {
    const exampleTurns: Turn[] = [];
    for (const text of EXAMPLE_TURNS) {
      exampleTurns.push({ id: Date.now() + exampleTurns.length, text, response: retrieveApprovedLotLiftResponse(text, exampleTurns.map((turn) => turn.text)) });
    }
    setTurns(exampleTurns);
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
            <Button variant="outline" onClick={() => setTurns([])} disabled={turns.length === 0}><RotateCcw className="size-4" />Clear call</Button>
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
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Best next response</p>
              <h2 id="response-heading" className="mt-1 text-base font-semibold">{latest?.title ?? "Waiting for an objection"}</h2>
            </div>
            <div className="space-y-5 p-4 sm:p-5">
              {latest ? <>
                <p className="text-base leading-7">“{latest.response}”</p>
                <div className="border-t pt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Context used</h3>
                  <p className="mt-2 text-sm leading-6">{latest.consideration}</p>
                  {context.length > 0 && <ul className="mt-3 space-y-2 border-l-2 border-foreground/30 pl-3 text-sm text-muted-foreground">{context.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>}
                </div>
              </> : <div className="flex min-h-44 flex-col justify-center gap-2 text-sm text-muted-foreground"><Sparkles className="size-5" aria-hidden="true" /><p>When a recognized objection arrives, one approved response appears here.</p></div>}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
