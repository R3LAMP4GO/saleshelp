import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "../tauriEvents";
import { hydrateCustomSalesProfile, type CustomSalesProfile, validateCustomSalesProfile } from "./customProfiles";
import { getSalesProfile } from "./profiles";
import { type SalesProfileOverride, validateSalesProfileOverride } from "./profileOverrides";

const BROWSER_STORAGE_KEY = "sales-custom-profiles";
const BROWSER_OVERRIDES_STORAGE_KEY = "sales-profile-overrides";

export interface ImportedSalesPlaybook {
  name: string;
  text: string;
}

function parseProfiles(raw: string): CustomSalesProfile[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Saved sales profiles are malformed.");
  return parsed.map((profile) => hydrateCustomSalesProfile(profile as CustomSalesProfile));
}

export async function loadCustomSalesProfiles(): Promise<CustomSalesProfile[]> {
  if (!isTauri()) {
    const raw = globalThis.localStorage.getItem(BROWSER_STORAGE_KEY);
    return raw ? parseProfiles(raw) : [];
  }
  return parseProfiles(await invoke<string>("read_sales_profiles"));
}

export async function saveCustomSalesProfiles(profiles: CustomSalesProfile[]): Promise<void> {
  const valid = profiles.map(validateCustomSalesProfile);
  const json = JSON.stringify(valid);
  if (!isTauri()) {
    globalThis.localStorage.setItem(BROWSER_STORAGE_KEY, json);
    return;
  }
  await invoke("write_sales_profiles", { json });
}

function parseOverrides(raw: string): SalesProfileOverride[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Saved sales profile overrides are malformed.");
  const seen = new Set<string>();
  return parsed.map((override) => {
    if (!override || typeof override !== "object") throw new Error("Saved sales profile override is malformed.");
    const candidate = override as SalesProfileOverride;
    const profile = getSalesProfile(candidate.profileId);
    if (!profile) throw new Error("Saved sales profile override references an unavailable profile.");
    const valid = validateSalesProfileOverride(candidate, profile);
    const key = `${valid.profileId}:${valid.baseVersion}`;
    if (seen.has(key)) throw new Error("Saved sales profile overrides must be unique.");
    seen.add(key);
    return valid;
  });
}

export async function loadSalesProfileOverrides(): Promise<SalesProfileOverride[]> {
  if (!isTauri()) {
    const raw = globalThis.localStorage.getItem(BROWSER_OVERRIDES_STORAGE_KEY);
    return raw ? parseOverrides(raw) : [];
  }
  return parseOverrides(await invoke<string>("read_sales_profile_overrides"));
}

export async function saveSalesProfileOverrides(overrides: SalesProfileOverride[]): Promise<void> {
  const seen = new Set<string>();
  const valid = overrides.map((override) => {
    const profile = getSalesProfile(override.profileId);
    if (!profile) throw new Error("Sales profile override references an unavailable profile.");
    const checked = validateSalesProfileOverride(override, profile);
    const key = `${checked.profileId}:${checked.baseVersion}`;
    if (seen.has(key)) throw new Error("Sales profile overrides must be unique.");
    seen.add(key);
    return checked;
  });
  const json = JSON.stringify(valid);
  if (!isTauri()) {
    globalThis.localStorage.setItem(BROWSER_OVERRIDES_STORAGE_KEY, json);
    return;
  }
  await invoke("write_sales_profile_overrides", { json });
}

export async function pickSalesPlaybook(): Promise<ImportedSalesPlaybook | null> {
  if (!isTauri()) return pickBrowserPlaybook();
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Choose a sales playbook",
    filters: [{ name: "Markdown playbook", extensions: ["md", "markdown"] }],
  });
  if (!selected || Array.isArray(selected)) return null;
  return invoke<ImportedSalesPlaybook>("read_sales_playbook_source", { path: selected });
}

function pickBrowserPlaybook(): Promise<ImportedSalesPlaybook | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,text/markdown";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve({ name: file.name, text: await file.text() });
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}
