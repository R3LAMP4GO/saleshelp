import { useEffect, useState } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { type CustomSalesProfile, validateCustomSalesProfile } from "../lib/sales/customProfiles";
import { loadCustomSalesProfiles, pickSalesPlaybook, saveCustomSalesProfiles } from "../lib/sales/customProfileStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BuiltinSalesProfileEditor } from "./BuiltinSalesProfileEditor";

export function SalesProfilesSettings() {
  const [profiles, setProfiles] = useState<CustomSalesProfile[]>([]);
  const [businessName, setBusinessName] = useState("");
  const [modeName, setModeName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    loadCustomSalesProfiles().then(setProfiles).catch((error) => toast.error(String(error)));
  }, []);

  async function importProfile() {
    if (!businessName.trim() || !modeName.trim()) return;
    setBusy(true);
    try {
      const source = await pickSalesPlaybook();
      if (!source) return;
      if (!/\.(?:md|markdown)$/i.test(source.name)) throw new Error("Choose a Markdown (.md or .markdown) playbook.");
      const now = new Date().toISOString();
      const profile = validateCustomSalesProfile({
        id: crypto.randomUUID(),
        businessName,
        modeName,
        sourceName: source.name,
        playbookText: source.text,
        createdAt: now,
        updatedAt: now,
      });
      const next = [...profiles, profile];
      await saveCustomSalesProfiles(next);
      setProfiles(next);
      setBusinessName("");
      setModeName("");
      setStatus("Playbook imported and ready for live coaching.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not import that playbook.";
      setStatus(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function removeProfile(profile: CustomSalesProfile) {
    setBusy(true);
    try {
      const next = profiles.filter((candidate) => candidate.id !== profile.id);
      await saveCustomSalesProfiles(next);
      setProfiles(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete that profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <BuiltinSalesProfileEditor />
      <div className="border-t pt-6">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Markdown only. Required: # title, ## Call objective, ## Script stages, ## Objection rules, and ## Product facts. Facts use ### product:kebab-id, **Statement:** one sentence, and **Category:** capability, pricing, integration, security, roi, or guarantee.
      </p>
      <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
        <div className="min-w-40 flex-1"><label htmlFor="sales-business-name" className="mb-1 block text-xs">Business name</label><Input id="sales-business-name" value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="Acme Co." /></div>
        <div className="min-w-40 flex-1"><label htmlFor="sales-mode-name" className="mb-1 block text-xs">Mode name</label><Input id="sales-mode-name" value={modeName} onChange={(event) => setModeName(event.target.value)} placeholder="Discovery" /></div>
        <Button size="sm" disabled={busy || !businessName.trim() || !modeName.trim()} onClick={() => void importProfile()}><Plus className="size-3.5" /> Import playbook</Button>
      </div>
      <p aria-live="polite" className="min-h-5 text-xs text-muted-foreground">{status}</p>
      {profiles.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">No custom sales profiles yet.</p>
      ) : profiles.map((profile) => (
        <div key={profile.id} className="flex items-start gap-3 rounded-lg border p-3">
          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">{profile.businessName} · {profile.modeName}</p><p className="truncate text-xs text-muted-foreground">{profile.sourceName}</p><p className="text-xs text-muted-foreground">{profile.compiledProfile ? `Ready · ${profile.compiledProfile.stages.length} stages · ${profile.compiledProfile.productFacts.length} facts` : "Needs re-import · live coaching is unavailable"}</p></div>
          <Button size="icon" variant="ghost" disabled={busy} className="size-8 text-muted-foreground hover:text-destructive" aria-label={`Delete ${profile.businessName} ${profile.modeName}`} title="Delete profile" onClick={() => void removeProfile(profile)}><Trash2 className="size-3.5" /></Button>
        </div>
      ))}
      </div>
    </div>
  );
}
