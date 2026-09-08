import { compileSalesPilotProfile, type SalesPilotProfile } from "./salesPilot";

export const CUSTOM_PROFILE_TEXT_LIMIT = 200_000;
export const CUSTOM_PROFILE_FIELD_LIMIT = 160;

export interface CustomSalesProfile {
  id: string;
  businessName: string;
  modeName: string;
  sourceName: string;
  playbookText: string;
  compiledProfile?: SalesPilotProfile;
  createdAt: string;
  updatedAt: string;
}

export interface CustomSalesProfileSnapshot {
  id: string;
  businessName: string;
  modeName: string;
  sourceName: string;
  playbookText: string;
  compiledProfile?: SalesPilotProfile;
  updatedAt: string;
}

export function normalizePlaybookText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim().slice(0, CUSTOM_PROFILE_TEXT_LIMIT);
}

function requiredField(value: string, name: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error(`${name} is required.`);
  if (normalized.length > CUSTOM_PROFILE_FIELD_LIMIT) throw new Error(`${name} is too long.`);
  return normalized;
}

export function hydrateCustomSalesProfile(profile: CustomSalesProfile): CustomSalesProfile {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profile.id)) throw new Error("Profile ID is invalid.");
  const playbookText = normalizePlaybookText(profile.playbookText);
  if (!playbookText) throw new Error("Playbook text is required.");
  const base = { ...profile, businessName: requiredField(profile.businessName, "Business name"), modeName: requiredField(profile.modeName, "Mode name"), sourceName: requiredField(profile.sourceName, "Source name"), playbookText };
  try { return { ...base, compiledProfile: compileSalesPilotProfile(playbookText) }; } catch { return base; }
}

export function validateCustomSalesProfile(profile: CustomSalesProfile): CustomSalesProfile {
  if (profile.playbookText.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim().length > CUSTOM_PROFILE_TEXT_LIMIT) throw new Error("Playbook text is too long.");
  const hydrated = hydrateCustomSalesProfile(profile);
  if (!hydrated.compiledProfile) throw new Error("Playbook must use the required sales-pilot Markdown sections.");
  return hydrated;
}

export function customSalesProfileSnapshot(profile: CustomSalesProfile): CustomSalesProfileSnapshot {
  const { id, businessName, modeName, sourceName, playbookText, compiledProfile, updatedAt } = hydrateCustomSalesProfile(profile);
  return { id, businessName, modeName, sourceName, playbookText, ...(compiledProfile && { compiledProfile }), updatedAt };
}
