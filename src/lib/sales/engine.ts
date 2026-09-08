import { initLotLiftSalesAdapter } from "../../../sales-profiles/lotlift/adapter";
import { useStore } from "../store";
import { resolveApprovedSalesProfile } from "./policy";

const adapters = {
  "lotlift-cold-outbound": initLotLiftSalesAdapter,
} as const;

/** Routes lifecycle to exactly one approved profile adapter at a time. */
export function initSalesCoach(): () => void {
  let activeProfileId: string | null = null;
  let stopAdapter: (() => void) | null = null;
  const sync = () => {
    const profile = resolveApprovedSalesProfile(useStore.getState().salesMetadata);
    const nextId = profile && profile.id in adapters ? profile.id : null;
    if (nextId === activeProfileId) return;
    stopAdapter?.();
    activeProfileId = nextId;
    stopAdapter = nextId ? adapters[nextId as keyof typeof adapters]() : null;
  };
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.salesMetadata !== previous.salesMetadata) sync();
  });
  sync();
  return () => {
    unsubscribe();
    stopAdapter?.();
  };
}
