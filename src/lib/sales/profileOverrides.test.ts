import { expect, it } from "vitest";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../../../sales-profiles/lotlift/profile";
import { salesMeetingMetadata } from "./meeting";
import {
  duplicateSalesProfileOverride,
  resetSalesProfileMoveOverride,
  resolveSalesProfileOverride,
  validateSalesProfileOverride,
} from "./profileOverrides";

it("isolates a validated O3 override and snapshots it into a new meeting", () => {
  const override = validateSalesProfileOverride({
    profileId: LOTLIFT_COLD_OUTBOUND_PROFILE.id,
    baseVersion: LOTLIFT_COLD_OUTBOUND_PROFILE.profile.version,
    moves: { O3: { script: "I’m calling to learn who owns your online leads. Is that you?" } },
    updatedAt: "2026-01-01T00:00:00.000Z",
  }, LOTLIFT_COLD_OUTBOUND_PROFILE);
  const duplicate = duplicateSalesProfileOverride(override);
  duplicate.moves!.O3!.script = "Changed only in the duplicate.";
  expect(override.moves!.O3!.script).not.toBe(duplicate.moves!.O3!.script);
  const resolved = resolveSalesProfileOverride(LOTLIFT_COLD_OUTBOUND_PROFILE, override);
  const metadata = salesMeetingMetadata(LOTLIFT_COLD_OUTBOUND_PROFILE, undefined, "2026-01-01T00:00:00.000Z", resolved);
  expect(metadata.resolvedProfile?.behavior.moves.find((move) => move.id === "O3")?.script).toContain("online leads");
  expect(resolveSalesProfileOverride(LOTLIFT_COLD_OUTBOUND_PROFILE, resetSalesProfileMoveOverride(override, "O3")).behavior.moves.find((move) => move.id === "O3")?.script).toBe(LOTLIFT_COLD_OUTBOUND_PROFILE.behavior.moves.find((move) => move.id === "O3")?.script);
  expect(metadata.resolvedProfile?.snapshotVersion).toBe(resolved.snapshotVersion);
});

it("rejects unknown moves and unsafe script variables", () => {
  expect(() => validateSalesProfileOverride({ profileId: LOTLIFT_COLD_OUTBOUND_PROFILE.id, baseVersion: LOTLIFT_COLD_OUTBOUND_PROFILE.profile.version, moves: { NOPE: { script: "Nope" } }, updatedAt: "2026-01-01T00:00:00.000Z" }, LOTLIFT_COLD_OUTBOUND_PROFILE)).toThrow("unknown");
  expect(() => validateSalesProfileOverride({ profileId: LOTLIFT_COLD_OUTBOUND_PROFILE.id, baseVersion: LOTLIFT_COLD_OUTBOUND_PROFILE.profile.version, moves: { O3: { script: "Hi [unknown]." } }, updatedAt: "2026-01-01T00:00:00.000Z" }, LOTLIFT_COLD_OUTBOUND_PROFILE)).toThrow("undeclared");
});
