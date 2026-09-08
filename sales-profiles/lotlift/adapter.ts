import { initLotLiftCoach } from "../../src/lib/lotlift/coach";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "./profile";

/** Transitional adapter: existing LotLift policy owns coaching decisions and state reduction. */
export function initLotLiftSalesAdapter(): () => void {
  return initLotLiftCoach(undefined, undefined, LOTLIFT_COLD_OUTBOUND_PROFILE.id);
}
