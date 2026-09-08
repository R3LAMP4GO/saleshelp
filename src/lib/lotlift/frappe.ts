import { invoke } from "@tauri-apps/api/core";
import type { FrappeSettings } from "../types";

export type LotLiftFrappeOutboxState = "pending" | "sending" | "delivered" | "retry" | "dead-letter";

export interface LotLiftFrappeOutboxEntry {
  idempotency_key: string;
  call_id: string;
  revision: number;
  event_type: "analysis" | "dnc" | "contact_update";
  state: LotLiftFrappeOutboxState;
  attempts: number;
  next_attempt_at: number;
  remote_name: string | null;
  last_error: string | null;
}

function nativeConfig(settings: FrappeSettings) {
  return {
    baseUrl: settings.baseUrl,
    authMethod: settings.authMethod,
    credentialReference: settings.credentialReference,
    leadDoctype: settings.leadDoctype,
    identityField: settings.identityField,
    identitySource: settings.identitySource,
    fieldMapping: settings.fieldMapping,
  };
}

/** Stores a token in the native OS credential vault, never in persisted Settings. */
export function saveLotLiftFrappeCredential(reference: string, secret: string): Promise<void> {
  return invoke("save_lotlift_frappe_credential", { reference, secret });
}

/** Creates an on-disk outbox item from an already committed final analysis. */
export function enqueueLotLiftFrappeSync(callId: string, settings: FrappeSettings, eventType?: "contact_update"): Promise<LotLiftFrappeOutboxEntry> {
  if (!settings.enabled) return Promise.reject(new Error("Frappe sync is disabled"));
  return invoke("enqueue_lotlift_frappe_sync", { callId, config: nativeConfig(settings), eventType });
}

/** Explicit delivery/recovery action; never used by live-call execution. */
export function deliverLotLiftFrappeOutbox(): Promise<LotLiftFrappeOutboxEntry[]> {
  return invoke("deliver_lotlift_frappe_outbox");
}
