export type SalesPilotLiveStatus = { profile: string; stage: string; label: string } | null;

let status: SalesPilotLiveStatus = null;
const listeners = new Set<() => void>();

export function getSalesPilotLiveStatus(): SalesPilotLiveStatus { return status; }
export function setSalesPilotLiveStatus(next: SalesPilotLiveStatus): void { status = next; listeners.forEach((listener) => listener()); }
export function subscribeSalesPilotLiveStatus(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
