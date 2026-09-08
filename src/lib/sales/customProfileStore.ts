import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "../tauriEvents";
import { hydrateCustomSalesProfile, type CustomSalesProfile, validateCustomSalesProfile } from "./customProfiles";

const BROWSER_STORAGE_KEY = "sales-custom-profiles";

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
