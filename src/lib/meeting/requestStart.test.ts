import { expect, it } from "vitest";
import {
  dismissMeetingStartRequest,
  isMeetingStartRequested,
  requestMeetingStart,
  subscribeMeetingStartRequest,
} from "./requestStart";

it("coalesces concurrent launcher requests into one shared selector", () => {
  dismissMeetingStartRequest();
  let notifications = 0;
  const unsubscribe = subscribeMeetingStartRequest(() => notifications++);
  requestMeetingStart();
  requestMeetingStart();
  expect(isMeetingStartRequested()).toBe(true);
  expect(notifications).toBe(1);
  dismissMeetingStartRequest();
  expect(isMeetingStartRequested()).toBe(false);
  unsubscribe();
});
