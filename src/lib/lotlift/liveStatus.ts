export type LotLiftLiveStatus = "Listening" | "Thinking" | "Suggestion ready" | "No intervention needed" | "Local model unavailable" | "Fallback used" | "API key missing — fallback used";

const target = new EventTarget();
let status: LotLiftLiveStatus = "Listening";

export function setLotLiftLiveStatus(next: LotLiftLiveStatus): void {
  status = next;
  target.dispatchEvent(new Event("change"));
}
export function getLotLiftLiveStatus(): LotLiftLiveStatus { return status; }
export function subscribeLotLiftLiveStatus(listener: () => void): () => void {
  target.addEventListener("change", listener);
  return () => target.removeEventListener("change", listener);
}
