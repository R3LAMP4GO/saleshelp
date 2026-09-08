import type { SalesProspectReference } from "./meeting";

export interface DoNotContactRecord {
  businessId: string;
  canonicalProspectId: string;
  recordedAt: string;
}

export interface LeadMemory {
  findDoNotContact(businessId: string, prospect: SalesProspectReference | undefined): DoNotContactRecord | null;
  recordDoNotContact(record: DoNotContactRecord): void;
}

const STORAGE_KEY = "parley-sales-lead-memory-v1";

export function normalizePhone(phone: string | undefined): string | undefined {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : undefined;
}

export function normalizeProspect(prospect: SalesProspectReference): SalesProspectReference {
  const text = (value: string | undefined, maxLength: number) => value?.trim().slice(0, maxLength) || undefined;
  return {
    name: text(prospect.name, 160),
    role: text(prospect.role, 160),
    phone: normalizePhone(prospect.phone),
    crmLeadId: text(prospect.crmLeadId, 128),
  };
}

export function canonicalProspectId(prospect: SalesProspectReference | undefined): string | null {
  const normalized = prospect && normalizeProspect(prospect);
  if (!normalized) return null;
  if (normalized.crmLeadId) return `crm:${normalized.crmLeadId.toLocaleLowerCase()}`;
  return normalized.phone ? `phone:${normalized.phone}` : null;
}

export function isProspectDoNotContact(memory: LeadMemory, businessId: string, prospect: SalesProspectReference | undefined): boolean {
  return memory.findDoNotContact(businessId, prospect) !== null;
}

export function createLeadMemory(records: DoNotContactRecord[] = []): LeadMemory {
  const entries = new Map(records.map((record) => [`${record.businessId}:${record.canonicalProspectId}`, record]));
  return {
    findDoNotContact(businessId, prospect) {
      const id = canonicalProspectId(prospect);
      return id ? entries.get(`${businessId}:${id}`) ?? null : null;
    },
    recordDoNotContact(record) {
      entries.set(`${record.businessId}:${record.canonicalProspectId}`, record);
    },
  };
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function readRecords(): DoNotContactRecord[] {
  try {
    const raw = browserStorage()?.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isDncRecord) : [];
  } catch {
    return [];
  }
}

function isDncRecord(value: unknown): value is DoNotContactRecord {
  const record = value as DoNotContactRecord | null;
  return !!record && typeof record.businessId === "string" && typeof record.canonicalProspectId === "string" && typeof record.recordedAt === "string";
}

const durableMemory = createLeadMemory(readRecords());

export const leadMemory: LeadMemory = {
  findDoNotContact: durableMemory.findDoNotContact,
  recordDoNotContact(record) {
    durableMemory.recordDoNotContact(record);
    try {
      const existing = readRecords().filter((item) => `${item.businessId}:${item.canonicalProspectId}` !== `${record.businessId}:${record.canonicalProspectId}`);
      browserStorage()?.setItem(STORAGE_KEY, JSON.stringify([...existing, record]));
    } catch {
      // The current-session DNC record remains active when persistent storage is unavailable.
    }
  },
};
