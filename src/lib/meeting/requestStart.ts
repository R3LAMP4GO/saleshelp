type Listener = () => void;

let requested = false;
const listeners = new Set<Listener>();

export function requestMeetingStart(): void {
  if (requested) return;
  requested = true;
  listeners.forEach((listener) => listener());
}

export function dismissMeetingStartRequest(): void {
  if (!requested) return;
  requested = false;
  listeners.forEach((listener) => listener());
}

export function subscribeMeetingStartRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isMeetingStartRequested(): boolean {
  return requested;
}
