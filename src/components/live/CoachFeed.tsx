import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useStore, speakerKey, speakerLabel } from "../../lib/store";
import { useStickToBottom } from "../../lib/useStickToBottom";
import { runAnalysis } from "../../lib/analysis/engine";
import { useI18n } from "../../i18n";
import { log } from "../../lib/log";
import { getSalesPilotLiveStatus, subscribeSalesPilotLiveStatus } from "../../lib/sales/liveStatus";
import { getLotLiftLiveStatus, subscribeLotLiftLiveStatus } from "../../lib/lotlift/liveStatus";
import { FindingRow } from "../analysis/FindingRow";
import { speakerDotClass } from "../../lib/speakerColors";
import { selectAndSeek } from "../analysis/useAnalysis";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Auto-analysis cadence, reachable from the coach posture (⑥). The same two
 * controls used to exist ONLY in the transcript posture's findings panel, so
 * whether the feed refreshed itself depended on a posture the user might never
 * open — the setting is global, its door was not.
 */
function AutoAnalyzeMenu() {
  const { t } = useI18n();
  const autoAnalyze = useStore((s) => s.autoAnalyze);
  const autoAnalyzeSec = useStore((s) => s.autoAnalyzeSec);
  const setAutoAnalyze = useStore((s) => s.setAutoAnalyze);
  const setAutoAnalyzeSec = useStore((s) => s.setAutoAnalyzeSec);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-6 rounded-l-none"
          aria-label={t("evaluations.autoEvery")}
          title={
            autoAnalyze
              ? t("evaluations.autoOnHint", { sec: autoAnalyzeSec })
              : t("evaluations.autoOffHint")
          }
        >
          <ChevronDown className="size-3" />
          {autoAnalyze && (
            <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-emerald-500" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={autoAnalyze}
            onChange={(e) => setAutoAnalyze(e.target.checked)}
            className="size-3.5 accent-primary"
          />
          {t("evaluations.autoEvery")}
          <Input
            type="number"
            value={autoAnalyzeSec}
            onChange={(e) => setAutoAnalyzeSec(Number(e.target.value))}
            className="h-6 w-14 px-1 text-center text-xs"
            disabled={!autoAnalyze}
          />
          {t("evaluations.autoSeconds")}
        </label>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The header upload button's other replacement: import from the idle feed —
 * the shared flow (R7), so it takes .txt transcripts too, not just audio.
 */
async function importRecording() {
  try {
    const { startImportFlow } = await import("../../lib/replay/ingest");
    await startImportFlow();
  } catch (e) {
    log.error("feed: import failed", { error: String(e) });
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

/** Empty-state illustration: a quiet stack of coach cards waiting to arrive. */
function SpeakerPicker() {
  const segments = useStore((s) => s.segments);
  const names = useStore((s) => s.speakerNames);
  const selfSpeakerKey = useStore((s) => s.selfSpeakerKey);
  const setSelfSpeakerKey = useStore((s) => s.setSelfSpeakerKey);
  const speakers = useMemo(() => {
    const seen = new Set<string>();
    return segments.filter((segment) => {
      if (segment.source !== "mix" || !segment.text.trim() || seen.has(speakerKey(segment))) return false;
      seen.add(speakerKey(segment));
      return true;
    });
  }, [segments]);

  if (speakers.length < 2) return null;
  return (
    <section className="rounded-lg border px-3 py-2.5" aria-labelledby="speaker-picker-title">
      <p id="speaker-picker-title" className="text-sm font-medium">Which speaker are you?</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Choose once so your coach only responds to the other person.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {speakers.map((speaker) => {
          const key = speakerKey(speaker);
          const selected = selfSpeakerKey === key;
          return (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={selected ? "default" : "outline"}
              className="h-7"
              aria-pressed={selected}
              onClick={() => setSelfSpeakerKey(key)}
            >
              <span className={`size-2 rounded-full ${speakerDotClass(speaker)}`} aria-hidden />
              I’m {speakerLabel(speaker, names)}
            </Button>
          );
        })}
      </div>
    </section>
  );
}

function FeedPlaceholder() {
  return (
    <svg viewBox="0 0 220 140" className="mx-auto h-28 w-44 text-muted-foreground/40" aria-hidden>
      {/* faint incoming-signal dashes, well above the stack */}
      <line x1="82" y1="8" x2="94" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".25" />
      <line x1="104" y1="8" x2="118" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".35" />
      <line x1="128" y1="8" x2="136" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".25" />
      {/* front card with the coach's accent dot */}
      <rect x="40" y="22" width="120" height="28" rx="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="54" cy="36" r="4.5" className="text-emerald-500/70" fill="currentColor" />
      <line x1="64" y1="31" x2="140" y2="31" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".55" />
      <line x1="64" y1="41" x2="120" y2="41" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".3" />
      {/* middle card, gently tilted */}
      <g transform="rotate(-2 104 71)">
        <rect x="48" y="60" width="112" height="22" rx="6" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".6" />
        <line x1="60" y1="71" x2="126" y2="71" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".35" />
      </g>
      {/* back card, settling out of view */}
      <g transform="rotate(2 100 102)">
        <rect x="52" y="94" width="96" height="16" rx="6" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".35" />
      </g>
      {/* the whistle: your coach, standing by (bottom-right, clear of the stack) */}
      <g className="text-emerald-500/70" transform="translate(188 118) rotate(-15)">
        <circle cx="0" cy="0" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="0" cy="0" r="2.4" fill="currentColor" />
        <path d="M6 -6 L26 -13 L27.8 -7.6 L9 -1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/**
 * The LIVE center pane: one chronological coach stream — evaluation findings
 * with each automatic response rendered directly as a “Say this” instruction.
 * The center of the screen is reserved for live coaching, not a second search flow.
 */
export function CoachFeed({ onSeek }: Readonly<{ onSeek: (ms: number) => void }>) {
  const { t } = useI18n();
  const findings = useStore((s) => s.findings);
  const selectedId = useStore((s) => s.selectedFindingId);
  const analysisStatus = useStore((s) => s.analysisStatus);
  const running = analysisStatus === "running";

  const [salesPilotStatus, setSalesPilotStatus] = useState(getSalesPilotLiveStatus);
  const [lotLiftStatus, setLotLiftStatus] = useState(getLotLiftLiveStatus);
  const findingSolutions = useStore((s) => s.findingSolutions);
  // Same follow-the-tail rule as the transcript: chase new cards only while
  // the reader is already at the bottom. No pill here — the feed's own ask bar
  // already sits under it, and a second floating control would crowd it.
  const { viewportRef } = useStickToBottom([findings.length, findingSolutions]);

  useEffect(() => subscribeSalesPilotLiveStatus(() => setSalesPilotStatus(getSalesPilotLiveStatus())), []);
  useEffect(() => subscribeLotLiftLiveStatus(() => setLotLiftStatus(getLotLiftLiveStatus())), []);

  const empty = findings.length === 0;
  const recording = useStore((s) => s.meetingStatus === "recording");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Feed header: the analyze action (the feed's manual refresh). */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("feed.title")}
        </span>
        <div className="flex items-center gap-2">
          {salesPilotStatus ? <span aria-live="polite" className="max-w-48 truncate text-xs text-muted-foreground">{salesPilotStatus.profile} · {salesPilotStatus.stage.replace(/-/g, " ")} · {salesPilotStatus.label}</span> : <span aria-live="polite" className="max-w-48 truncate text-xs text-muted-foreground">{lotLiftStatus}</span>}
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-r-none border-r-0"
            disabled={running}
            onClick={() =>
              runAnalysis({ mode: "live" }).catch((e) =>
                log.error("analysis: live run failed", { error: String(e) })
              )
            }
          >
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {t("feed.analyze")}
          </Button>
          <AutoAnalyzeMenu />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" viewportRef={viewportRef}>
        <div className="flex flex-col gap-2 px-3 pb-2">
          {recording && <SpeakerPicker />}
          {empty && (
            <div className="flex flex-col items-center gap-3 px-1 py-10">
              <FeedPlaceholder />
              <p className="max-w-56 text-center text-sm text-muted-foreground">{t("feed.empty")}</p>
              {!recording && (
                <button
                  type="button"
                  onClick={() => void importRecording()}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  {t("feed.import")}
                </button>
              )}
            </div>
          )}
          {findings.map((f) => (
            <FindingRow
              key={f.id}
              event={f}
              selected={f.id === selectedId}
              onSelect={(ev) => selectAndSeek(ev, onSeek)}
              reply={findingSolutions[f.id]?.solution?.replies[0]?.reply}
            />
          ))}
        </div>
      </ScrollArea>

    </div>
  );
}
