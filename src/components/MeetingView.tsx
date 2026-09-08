import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";
import { TranscriptPanel } from "./TranscriptPanel";
import { SpeakerBar } from "./SpeakerBar";
import { AnalysisTimeline } from "./analysis/AnalysisTimeline";
import { selectAndSeek } from "./analysis/useAnalysis";
import { runAnalysis } from "../lib/analysis/engine";
import { findActiveTemplate } from "../lib/evaluations/presets";
import { useStore, transcriptAsText, formatClock, meetingElapsedMs } from "../lib/store";
import { useI18n } from "../i18n";
import { Button } from "@/components/ui/button";
import { finalizeLotLiftCall, type LotLiftFinalCallAnalysis } from "../lib/lotlift/finalAnalysis";

/** Build a markdown record of the meeting: context, transcript, analysis findings. */
function buildMarkdown(): string {
  const { segments, findings, speakerNames, meetingContext } = useStore.getState();
  const now = new Date();
  const lines = [`# Parley meeting — ${now.toLocaleString()}`, ""];
  if (meetingContext.trim()) {
    lines.push(`**Context:** ${meetingContext.trim()}`, "");
  }
  if (findings.length) {
    lines.push("## Findings", "");
    for (const f of findings) {
      const tag = [f.side ?? f.category, f.severity].filter(Boolean).join(", ");
      lines.push(`- [${formatClock(f.atMs)}] **${f.title}** (${tag}): ${f.detail}`);
    }
    lines.push("");
  }
  lines.push("## Transcript", "", transcriptAsText(segments, speakerNames) || "(empty)", "");
  return lines.join("\n");
}

export function MeetingView() {
  const { t } = useI18n();
  const segments = useStore((s) => s.segments);
  const hasSegments = segments.some((x) => x.isFinal && x.text.trim());
  const meetingId = useStore((s) => s.meetingId);
  const settings = useStore((s) => s.settings);
  const [copied, setCopied] = useState(false);
  const [finalAnalysis, setFinalAnalysis] = useState<LotLiftFinalCallAnalysis | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalAnalysisError, setFinalAnalysisError] = useState<string | null>(null);

  // Shared analysis state — the live timeline band aligned to elapsed meeting time.
  const findings = useStore((s) => s.findings);
  const analysisStatus = useStore((s) => s.analysisStatus);
  const analysisError = useStore((s) => s.analysisError);
  const selectedId = useStore((s) => s.selectedFindingId);
  const highlightMs = useStore((s) => s.highlightMs);
  const setHighlightMs = useStore((s) => s.setHighlightMs);
  const meetingStartedAt = useStore((s) => s.meetingStartedAt);
  const meetingPausedAt = useStore((s) => s.meetingPausedAt);
  const meetingPausedTotalMs = useStore((s) => s.meetingPausedTotalMs);
  const meetingStatus = useStore((s) => s.meetingStatus);
  const recording = meetingStatus === "recording";
  const meetingActive = meetingStatus === "recording" || meetingStatus === "paused";
  const maxEndMs = useStore((s) => s.segments.reduce((m, x) => Math.max(m, x.endMs), 0));
  const evalTemplates = useStore((s) => s.settings.evalTemplates);
  const evaluations = useStore((s) => s.settings.evaluations);
  const activeTemplate = findActiveTemplate(evalTemplates, evaluations);

  // Tick once a second so the axis right-edge advances while recording (a
  // pause freezes the elapsed value, so ticking through it is a no-op).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => {
    setFinalAnalysis(null);
    setFinalAnalysisError(null);
  }, [meetingId]);

  // Recorded-time elapsed (wall minus pauses) so the axis matches segment
  // timestamps — which the STT clock also compacts over pauses.
  const elapsedMs =
    meetingActive && meetingStartedAt
      ? meetingElapsedMs({ meetingStartedAt, meetingPausedAt, meetingPausedTotalMs }, nowMs)
      : maxEndMs;
  const axisMaxMs = Math.max(elapsedMs, maxEndMs, 1);
  const showTimeline = findings.length > 0 || analysisStatus === "running" || analysisStatus === "error";

  const callId = meetingId ? `lotlift-${meetingId}` : null;
  const canFinalize = (meetingStatus === "paused" || meetingStatus === "stopped") && hasSegments && !!callId;

  async function finalize() {
    if (!callId || !canFinalize) return;
    setFinalizing(true);
    setFinalAnalysisError(null);
    try {
      setFinalAnalysis(await finalizeLotLiftCall(callId, segments, settings));
    } catch (error) {
      setFinalAnalysisError(error instanceof Error ? error.message : "Local final analysis failed");
    } finally {
      setFinalizing(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(buildMarkdown());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      console.error("copy transcript failed", e);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-5">
        <span className="text-xs font-medium text-foreground">{t("meeting.transcript")}</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" disabled={!hasSegments} onClick={copy}>
            {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
            {copied ? t("meeting.copied") : t("meeting.copy")}
          </Button>
          {callId && <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" disabled={!canFinalize || finalizing} onClick={() => void finalize()} title={canFinalize ? "Analyze the saved Call State locally" : "Pause or stop the call after the transcript stabilizes to finalize locally"}>
            {finalizing ? "Finalizing…" : finalAnalysis ? "Retry local analysis" : "Finalize locally"}
          </Button>}
        </div>
      </div>
      {(finalAnalysis || finalAnalysisError) && <section className="border-b px-5 py-3 text-sm" aria-live="polite" aria-label="Local final analysis">
        <p className="font-medium">Local final analysis {finalAnalysis ? `· ${finalAnalysis.analysis_status.replace(/_/g, " ")}` : "unavailable"}</p>
        {finalAnalysisError ? <p className="mt-1 text-muted-foreground">{finalAnalysisError}</p> : <>
          <p className="mt-1 text-muted-foreground">{finalAnalysis?.summary.value ?? "Insufficient grounded evidence. No CRM delivery was attempted."}</p>
          {[finalAnalysis?.summary, finalAnalysis?.call_outcome, finalAnalysis?.recommended_follow_up, finalAnalysis?.crm_note].flatMap((fact) => fact?.evidence ? [fact.evidence] : []).map((evidence) => <blockquote key={`${evidence.segment_id}-${evidence.text}`} className="mt-2 border-l-2 pl-2 text-xs text-muted-foreground">“{evidence.text}”</blockquote>)}
          {finalAnalysis?.contradictions.length ? <p className="mt-2 text-xs text-muted-foreground">Contradictions retained: {finalAnalysis.contradictions.map((item) => item.field).join(", ")}</p> : null}
        </>}
      </section>}
      {showTimeline && (
        <AnalysisTimeline
          findings={findings}
          status={analysisStatus}
          error={analysisError}
          axisMaxMs={axisMaxMs}
          playheadMs={highlightMs ?? elapsedMs}
          selectedId={selectedId}
          onSelect={(e) => selectAndSeek(e, setHighlightMs)}
          onReanalyze={() => void runAnalysis({ mode: "live" })}
          templateName={activeTemplate ? activeTemplate.name : t("timeline.templateCustom")}
        />
      )}
      <SpeakerBar />
      <div className="min-h-0 flex-1">
        <TranscriptPanel />
      </div>
    </div>
  );
}
