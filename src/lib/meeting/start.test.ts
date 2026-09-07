import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startMeeting: vi.fn(),
  stopMeeting: vi.fn(),
  toastError: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("../store", () => ({
  useStore: {
    getState: () => ({
      settings: { transcriptionProvider: "soniox", language: "en" },
      startMeeting: mocks.startMeeting,
      stopMeeting: mocks.stopMeeting,
    }),
  },
}));
vi.mock("../transcription/providers", () => ({
  STT_BY_ID: {},
  sttApiKey: () => "",
  sttRelayUrl: () => undefined,
}));
vi.mock("../dictionary", () => ({ vocabularyTerms: () => [] }));
vi.mock("../tauriEvents", () => ({ isTauri: () => true }));
vi.mock("../../i18n/messages", () => ({ translate: () => "", }));
vi.mock("../log", () => ({ log: { info: vi.fn(), error: vi.fn() } }));

import { beginMeeting } from "./start";

describe("beginMeeting", () => {
  it("stops and explains missing provider credentials instead of injecting a mock transcript", async () => {
    await beginMeeting();

    expect(mocks.startMeeting).toHaveBeenCalledOnce();
    expect(mocks.stopMeeting).toHaveBeenCalledOnce();
    expect(mocks.toastError).toHaveBeenCalledWith("Configure a transcription provider before starting a meeting.");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
