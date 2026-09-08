import { useEffect, useState, useSyncExternalStore } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "../i18n";
import { beginMeeting } from "../lib/meeting/start";
import {
  dismissMeetingStartRequest,
  isMeetingStartRequested,
  subscribeMeetingStartRequest,
} from "../lib/meeting/requestStart";
import { availableSalesProfiles, getSalesProfile } from "../lib/sales/profiles";
import { customSalesMeetingMetadata, salesMeetingMetadata, type SalesProspectReference } from "../lib/sales/meeting";
import { type CustomSalesProfile } from "../lib/sales/customProfiles";
import { loadCustomSalesProfiles } from "../lib/sales/customProfileStore";
import { isProspectDoNotContact, leadMemory, normalizeProspect } from "../lib/sales/leadMemory";
import "../../sales-profiles/lotlift/profile";

type Activity = "general" | "sales" | null;

export function StartCallDialog() {
  const { t } = useI18n();
  const open = useSyncExternalStore(subscribeMeetingStartRequest, isMeetingStartRequested, () => false);
  const [activity, setActivity] = useState<Activity>(null);
  const [profileId, setProfileId] = useState("");
  const [customProfiles, setCustomProfiles] = useState<CustomSalesProfile[]>([]);
  const [prospect, setProspect] = useState<SalesProspectReference>({});
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState("");
  const profiles = availableSalesProfiles();
  const selectedProfile = getSalesProfile(profileId);
  const selectedCustomProfile = customProfiles.find((profile) => profile.id === profileId);
  const selectedBusinessId = selectedProfile?.businessId ?? selectedCustomProfile?.businessName;
  const salesReady = activity === "sales" && !!selectedBusinessId;
  const normalizedProspect = normalizeProspect(prospect);
  const dncBlocked = activity === "sales" && !!selectedBusinessId && isProspectDoNotContact(leadMemory, selectedBusinessId, normalizedProspect);

  useEffect(() => {
    if (!open) return;
    loadCustomSalesProfiles().then(setCustomProfiles).catch(() => setStatus("Could not load custom sales profiles."));
  }, [open]);
  const ready = (activity === "general" || salesReady) && !dncBlocked;

  const updateProspect = (key: keyof SalesProspectReference, value: string) =>
    setProspect((current) => ({ ...current, [key]: value }));

  async function start() {
    if (!ready || starting) return;
    if (activity === "sales" && selectedBusinessId && isProspectDoNotContact(leadMemory, selectedBusinessId, normalizedProspect)) {
      setStatus(t("startCall.dncBlocked"));
      return;
    }
    setStarting(true);
    setStatus(t("startCall.starting"));
    const metadata = activity === "sales" && selectedProfile
      ? salesMeetingMetadata(selectedProfile, normalizedProspect)
      : activity === "sales" && selectedCustomProfile
        ? customSalesMeetingMetadata(selectedCustomProfile, normalizedProspect)
        : undefined;
    const started = await beginMeeting(metadata);
    setStarting(false);
    if (started) {
      setStatus("");
      setActivity(null);
      setProfileId("");
      setProspect({});
      dismissMeetingStartRequest();
    } else {
      setStatus(t("startCall.failed"));
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(nextOpen) => !nextOpen && dismissMeetingStartRequest()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[94] bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby="start-call-description"
          className="fixed left-1/2 top-1/2 z-[95] max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-background p-5 shadow-xl focus:outline-none"
        >
          <DialogPrimitive.Title className="text-base font-semibold">{t("startCall.title")}</DialogPrimitive.Title>
          <DialogPrimitive.Description id="start-call-description" className="mt-1 text-sm text-muted-foreground">
            {t("startCall.description")}
          </DialogPrimitive.Description>

          <fieldset className="mt-5 grid gap-2">
            <legend className="text-sm font-medium">{t("startCall.activity")}</legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <input type="radio" name="start-activity" value="general" checked={activity === "general"} onChange={() => setActivity("general")} />
              <span><span className="block text-sm font-medium">{t("startCall.general")}</span><span className="text-xs text-muted-foreground">{t("startCall.generalHint")}</span></span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <input type="radio" name="start-activity" value="sales" checked={activity === "sales"} onChange={() => setActivity("sales")} />
              <span><span className="block text-sm font-medium">{t("startCall.sales")}</span><span className="text-xs text-muted-foreground">{t("startCall.salesHint")}</span></span>
            </label>
          </fieldset>

          {activity === "sales" && (
            <div className="mt-5 grid gap-4">
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">{t("startCall.profile")}</legend>
                {profiles.map((profile) => (
                  <label key={profile.id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                    <input type="radio" name="sales-profile" value={profile.id} checked={profileId === profile.id} onChange={() => setProfileId(profile.id)} />
                    <span><span className="block text-sm font-medium">{profile.label}</span><span className="text-xs text-muted-foreground">{t("startCall.coldOutbound")}</span></span>
                  </label>
                ))}
                {customProfiles.map((profile) => (
                  <label key={profile.id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                    <input type="radio" name="sales-profile" value={profile.id} checked={profileId === profile.id} onChange={() => setProfileId(profile.id)} />
                    <span><span className="block text-sm font-medium">{profile.businessName} · {profile.modeName}</span><span className="text-xs text-muted-foreground">{profile.compiledProfile ? `Custom · ${profile.compiledProfile.stages[0]?.title ?? "Ready"}` : "Custom · re-import required for live coaching"}</span></span>
                  </label>
                ))}
                {profiles.length + customProfiles.length === 0 && <p className="text-sm text-muted-foreground">{t("startCall.noProfiles")}</p>}
              </fieldset>

              <fieldset className="grid gap-3 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">{t("startCall.prospect")}</legend>
                <p className="text-xs text-muted-foreground">{t("startCall.prospectHint")}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5"><Label htmlFor="prospect-name">{t("startCall.name")}</Label><Input id="prospect-name" value={prospect.name ?? ""} onChange={(event) => updateProspect("name", event.target.value)} autoComplete="name" maxLength={160} /></div>
                  <div className="grid gap-1.5"><Label htmlFor="prospect-role">{t("startCall.role")}</Label><Input id="prospect-role" value={prospect.role ?? ""} onChange={(event) => updateProspect("role", event.target.value)} autoComplete="organization-title" maxLength={160} /></div>
                  <div className="grid gap-1.5"><Label htmlFor="prospect-phone">{t("startCall.phone")}</Label><Input id="prospect-phone" value={prospect.phone ?? ""} onChange={(event) => updateProspect("phone", event.target.value)} autoComplete="tel" inputMode="tel" maxLength={32} /></div>
                  <div className="grid gap-1.5"><Label htmlFor="prospect-crm">{t("startCall.crmLeadId")}</Label><Input id="prospect-crm" value={prospect.crmLeadId ?? ""} onChange={(event) => updateProspect("crmLeadId", event.target.value)} maxLength={128} /></div>
                </div>
              </fieldset>
            </div>
          )}

          <p aria-live="polite" className="mt-4 min-h-5 text-sm text-muted-foreground">{dncBlocked ? t("startCall.dncBlocked") : status}</p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <DialogPrimitive.Close asChild><Button type="button" variant="outline" disabled={starting}>{t("common.cancel")}</Button></DialogPrimitive.Close>
            <Button type="button" disabled={!ready || starting} onClick={() => void start()}>{starting ? t("startCall.starting") : t("startCall.start")}</Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
