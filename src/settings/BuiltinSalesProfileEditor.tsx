import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, FileUp, Link2Off, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { availableSalesProfiles, type SalesProfile } from "../lib/sales/profiles";
import {
  duplicateSalesProfileOverride,
  resetSalesProfileMoveOverride,
  resolveSalesProfileOverride,
  type SalesProfileOverride,
  validateSalesProfileOverride,
} from "../lib/sales/profileOverrides";
import { loadSalesProfileOverrides, saveSalesProfileOverrides } from "../lib/sales/customProfileStore";
import { importKnowledgePdf, listKnowledgeSources, type KnowledgeRegistryEntry } from "../lib/sales/knowledgeStore";
import type { ProfileKnowledgeAttachment } from "../lib/sales/knowledge";

function matchingOverride(profile: SalesProfile, overrides: readonly SalesProfileOverride[]): SalesProfileOverride | undefined {
  return overrides.find((override) => override.profileId === profile.id && override.baseVersion === profile.profile.version);
}

export function BuiltinSalesProfileEditor() {
  const profiles = availableSalesProfiles();
  const [overrides, setOverrides] = useState<SalesProfileOverride[]>([]);
  const [selectedId, setSelectedId] = useState(profiles[0]?.id ?? "");
  const [draft, setDraft] = useState<SalesProfileOverride | null>(null);
  const [busy, setBusy] = useState(false);
  const [knowledgeSources, setKnowledgeSources] = useState<readonly KnowledgeRegistryEntry[]>([]);
  const selected = profiles.find((profile) => profile.id === selectedId) ?? null;

  useEffect(() => {
    let active = true;
    Promise.all([loadSalesProfileOverrides(), listKnowledgeSources()])
      .then(([loadedOverrides, loadedSources]) => { if (active) { setOverrides(loadedOverrides); setKnowledgeSources(loadedSources); } })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Could not load profile changes."));
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!selected) return;
    setDraft(duplicateSalesProfileOverride(matchingOverride(selected, overrides) ?? { profileId: selected.id, baseVersion: selected.profile.version, updatedAt: new Date().toISOString() }));
  }, [selectedId, overrides]);

  const resolved = useMemo(() => selected && draft ? resolveSalesProfileOverride(selected, draft) : null, [selected, draft]);
  if (!selected || !draft || !resolved) return null;
  const profile: SalesProfile = selected;
  const draftOverride: SalesProfileOverride = draft;
  const attachments = draft.knowledgeAttachments ?? profile.knowledgeAttachments ?? [];
  const defaultAttachments = profile.knowledgeAttachments ?? [];

  function setAttachments(next: readonly ProfileKnowledgeAttachment[]) {
    setDraft((current) => current ? { ...current, knowledgeAttachments: next.map((attachment, index) => ({ ...attachment, order: index + 1, scope: [...attachment.scope] })) } : current);
  }

  function updateAttachment(sourceId: string, update: Partial<ProfileKnowledgeAttachment>) {
    setAttachments(attachments.map((attachment) => attachment.sourceId === sourceId ? { ...attachment, ...update } : attachment));
  }

  function moveAttachment(sourceId: string, direction: -1 | 1) {
    const currentIndex = attachments.findIndex((attachment) => attachment.sourceId === sourceId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= attachments.length) return;
    const next = [...attachments];
    [next[currentIndex], next[nextIndex]] = [next[nextIndex]!, next[currentIndex]!];
    setAttachments(next);
  }

  async function addKnowledgePdf(attachment: ProfileKnowledgeAttachment) {
    setBusy(true);
    try {
      const title = knowledgeSources.find((entry) => entry.source.id === attachment.sourceId)?.source.title ?? attachment.sourceId.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
      const imported = await importKnowledgePdf(attachment.sourceId, title);
      if (!imported) return;
      setKnowledgeSources(await listKnowledgeSources());
      toast.success(imported.deduplicated ? "That PDF version was already prepared." : "PDF prepared for new sessions.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare that PDF. Choose a readable PDF and try again.");
    } finally { setBusy(false); }
  }

  function changeScript(moveId: string, script: string) {
    setDraft((current) => current ? { ...current, moves: { ...(current.moves ?? {}), [moveId]: { ...current.moves?.[moveId], script } } } : current);
  }

  function changeTurnStrategy(moveId: string, field: "objective" | "approach" | "avoid" | "desiredProgression", value: string, base: NonNullable<SalesProfile["behavior"]["moves"][number]["turnStrategy"]>) {
    setDraft((draftValue) => {
      if (!draftValue) return draftValue;
      const current = draftValue.moves?.[moveId]?.turnStrategy ?? base;
      const next = field === "approach" || field === "avoid" ? { ...current, [field]: value.split("\n").map((item) => item.trim()).filter(Boolean) } : { ...current, [field]: value };
      return { ...draftValue, moves: { ...(draftValue.moves ?? {}), [moveId]: { ...draftValue.moves?.[moveId], turnStrategy: next } } };
    });
  }

  async function save() {
    setBusy(true);
    try {
      const valid = validateSalesProfileOverride({ ...draftOverride, updatedAt: new Date().toISOString() }, profile);
      const next = [...overrides.filter((override) => !(override.profileId === profile.id && override.baseVersion === profile.profile.version)), valid];
      await saveSalesProfileOverrides(next);
      setOverrides(next);
      toast.success("Profile changes saved for new sessions.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save profile changes.");
    } finally { setBusy(false); }
  }

  async function resetAll() {
    if (!window.confirm(`Reset all local changes for ${profile.label}? New sessions will use the approved defaults.`)) return;
    setBusy(true);
    try {
      const next = overrides.filter((override) => !(override.profileId === profile.id && override.baseVersion === profile.profile.version));
      await saveSalesProfileOverrides(next);
      setOverrides(next);
      toast.success("Approved defaults restored for new sessions.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reset profile changes.");
    } finally { setBusy(false); }
  }

  return (
    <section className="flex max-w-2xl flex-col gap-3" aria-labelledby="built-in-sales-profiles-title">
      <div><h3 id="built-in-sales-profiles-title" className="text-sm font-medium">Built-in sales profiles</h3><p className="text-xs text-muted-foreground">Changes apply only to newly started sessions. Safety and claim checks remain fixed.</p></div>
      <fieldset className="grid gap-2"><legend className="text-xs font-medium">Choose a profile</legend>{profiles.map((profile) => <label key={profile.id} className="flex cursor-pointer gap-2 rounded-md border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"><input type="radio" name="built-in-sales-profile" checked={selectedId === profile.id} onChange={() => setSelectedId(profile.id)} /><span><span className="block text-sm font-medium">{profile.label}</span><span className="block text-xs text-muted-foreground">Snapshot {resolveSalesProfileOverride(profile, matchingOverride(profile, overrides)).snapshotVersion}</span></span></label>)}</fieldset>
      <div className="rounded-lg border p-3"><p className="text-xs font-medium">Overview</p><p className="mt-1 text-sm">{profile.label} · {profile.motion}</p><p className="text-xs text-muted-foreground">Approved profile version {profile.profile.version}; effective snapshot {resolved.snapshotVersion}.</p></div>
      <div className="grid gap-1.5"><label htmlFor="profile-objective" className="text-xs font-medium">Call objective</label><Textarea id="profile-objective" value={draft.objective ?? profile.behavior.objective} maxLength={500} onChange={(event) => setDraft((current) => current ? { ...current, objective: event.target.value } : current)} /><p className="text-xs text-muted-foreground">Keep this specific and factual. It guides new sessions only.</p></div>
      <details open className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Knowledge sources</summary><div className="mt-3 grid gap-3"><p className="text-xs text-muted-foreground">Prepared PDFs add strategy context to new sessions only. Profile scripts, safety rules, and product facts always take priority.</p>{attachments.map((attachment, index) => { const prepared = knowledgeSources.find((entry) => entry.source.id === attachment.sourceId); return <div key={attachment.sourceId} className="grid gap-2 border-t pt-3 first:border-t-0 first:pt-0"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-medium">{prepared?.source.title ?? attachment.role}</p><p className="text-xs text-muted-foreground">{prepared ? `Prepared · ${prepared.currentVersion.pageCount} pages` : "PDF not prepared"} · {attachment.enabled ? "Enabled" : "Disabled"}</p></div><div className="flex flex-wrap gap-1"><Button type="button" size="sm" variant="outline" disabled={busy || index === 0} aria-label={`Move ${attachment.role} earlier`} onClick={() => moveAttachment(attachment.sourceId, -1)}><ArrowUp className="size-3.5" /></Button><Button type="button" size="sm" variant="outline" disabled={busy || index === attachments.length - 1} aria-label={`Move ${attachment.role} later`} onClick={() => moveAttachment(attachment.sourceId, 1)}><ArrowDown className="size-3.5" /></Button></div></div><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={attachment.enabled} disabled={busy} onChange={(event) => updateAttachment(attachment.sourceId, { enabled: event.target.checked })} /> Use for new sessions</label><label className="grid max-w-48 gap-1 text-xs font-medium">Priority (0–100)<input className="h-9 rounded-md border bg-background px-3 text-sm" type="number" min={0} max={100} value={attachment.priority} disabled={busy} onChange={(event) => updateAttachment(attachment.sourceId, { priority: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /></label><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void addKnowledgePdf(attachment)}><FileUp className="size-3.5" /> {prepared ? "Replace PDF version" : "Add PDF"}</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setAttachments(attachments.filter((item) => item.sourceId !== attachment.sourceId))}><Link2Off className="size-3.5" /> Detach</Button></div></div>; })}{defaultAttachments.filter((attachment) => !attachments.some((current) => current.sourceId === attachment.sourceId)).map((attachment) => <div key={attachment.sourceId} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"><span className="text-xs text-muted-foreground">{attachment.role} is detached.</span><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setAttachments([...attachments, attachment])}>Attach again</Button></div>)}</div></details>
      <details open className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Script moves</summary><div className="mt-3 grid gap-4">{profile.behavior.moves.map((move) => <div key={move.id} className="grid gap-1.5 border-t pt-3 first:border-t-0 first:pt-0"><div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor={`profile-move-${move.id}`} className="text-xs font-medium">{move.id} · {move.title}</label><Button type="button" size="sm" variant="ghost" disabled={busy || !draft.moves?.[move.id]} onClick={() => setDraft((current) => current ? resetSalesProfileMoveOverride(current, move.id) : current)}><RotateCcw className="size-3.5" /> Reset move</Button></div><Textarea id={`profile-move-${move.id}`} value={draft.moves?.[move.id]?.script ?? move.script} maxLength={500} onChange={(event) => changeScript(move.id, event.target.value)} /><p className="text-xs text-muted-foreground">{move.responseMode} response · up to {move.maxWords} words{move.variables.length ? ` · variables: ${move.variables.map((variable) => `[${variable}]`).join(", ")}` : ""}</p>{move.turnStrategy && <div className="grid gap-1.5 border-l pl-3"><p className="text-xs font-medium">Turn strategy</p><label className="text-xs">Objective<Textarea value={draft.moves?.[move.id]?.turnStrategy?.objective ?? move.turnStrategy.objective} maxLength={500} onChange={(event) => changeTurnStrategy(move.id, "objective", event.target.value, move.turnStrategy!)} /></label><label className="text-xs">Approach (one instruction per line)<Textarea value={(draft.moves?.[move.id]?.turnStrategy?.approach ?? move.turnStrategy.approach).join("\n")} maxLength={2400} onChange={(event) => changeTurnStrategy(move.id, "approach", event.target.value, move.turnStrategy!)} /></label><label className="text-xs">Avoid (one instruction per line)<Textarea value={(draft.moves?.[move.id]?.turnStrategy?.avoid ?? move.turnStrategy.avoid).join("\n")} maxLength={2400} onChange={(event) => changeTurnStrategy(move.id, "avoid", event.target.value, move.turnStrategy!)} /></label><label className="text-xs">Desired progression<Textarea value={draft.moves?.[move.id]?.turnStrategy?.desiredProgression ?? move.turnStrategy.desiredProgression} maxLength={500} onChange={(event) => changeTurnStrategy(move.id, "desiredProgression", event.target.value, move.turnStrategy!)} /></label></div>}</div>)}</div></details>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Discovery and objections</summary><div className="mt-3 grid gap-3 text-xs text-muted-foreground">{[...profile.behavior.discovery, ...profile.behavior.objections].map((rule) => <div key={rule.id}><p className="font-medium text-foreground">{rule.id}</p><p className="whitespace-pre-wrap">{rule.guidance}</p></div>)}</div></details>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Close and product facts</summary><div className="mt-3 grid gap-3 text-xs text-muted-foreground"><div><p className="font-medium text-foreground">Close requirements</p>{profile.behavior.closeRequirements.map((requirement) => <p key={requirement} className="whitespace-pre-wrap">{requirement}</p>)}</div><div><p className="font-medium text-foreground">Approved product facts</p>{profile.productFactEntries.map((fact) => <p key={fact.id}>{fact.statement}</p>)}</div><div><p className="font-medium text-foreground">Claim constraints</p>{profile.behavior.claimConstraints.map((constraint) => <p key={constraint} className="whitespace-pre-wrap">{constraint}</p>)}</div></div></details>
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(duplicateSalesProfileOverride(matchingOverride(profile, overrides) ?? { profileId: profile.id, baseVersion: profile.profile.version, updatedAt: new Date().toISOString() }))}>Cancel</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void resetAll()}>Reset profile</Button><Button type="button" disabled={busy} onClick={() => void save()}>Save changes</Button></div>
    </section>
  );
}
