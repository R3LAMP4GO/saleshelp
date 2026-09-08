export const CUSTOM_PROFILE_TEXT_LIMIT = 200_000;
export const CUSTOM_PROFILE_FIELD_LIMIT = 160;

export interface CustomSalesProfile {
  id: string;
  businessName: string;
  modeName: string;
  sourceName: string;
  playbookText: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomSalesProfileSnapshot {
  id: string;
  businessName: string;
  modeName: string;
  sourceName: string;
  playbookText: string;
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

export function validateCustomSalesProfile(profile: CustomSalesProfile): CustomSalesProfile {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profile.id)) {
    throw new Error("Profile ID is invalid.");
  }
  const playbookText = normalizePlaybookText(profile.playbookText);
  if (!playbookText) throw new Error("Playbook text is required.");
  if (playbookText.length > CUSTOM_PROFILE_TEXT_LIMIT) throw new Error("Playbook text is too long.");
  return {
    ...profile,
    businessName: requiredField(profile.businessName, "Business name"),
    modeName: requiredField(profile.modeName, "Mode name"),
    sourceName: requiredField(profile.sourceName, "Source name"),
    playbookText,
  };
}

export function customSalesProfileSnapshot(profile: CustomSalesProfile): CustomSalesProfileSnapshot {
  const { id, businessName, modeName, sourceName, playbookText, updatedAt } = validateCustomSalesProfile(profile);
  return { id, businessName, modeName, sourceName, playbookText, updatedAt };
}
