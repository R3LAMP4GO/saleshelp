// @vitest-environment jsdom
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
const storeState = vi.hoisted(() => ({ openHome: vi.fn(), settings: { userName: "Avery Test", llmProviders: { realtime: "ollama" }, models: { ollama: { realtime: "qwen3:4b" } }, reasoningEffort: { realtime: "none" } } }));
vi.mock("../../lib/store", () => ({ useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState) }));
vi.mock("../../lib/tauriEvents", () => ({ isTauri: () => false }));
vi.mock("../../lib/transcription/providers", () => ({ sttApiKey: () => "", sttRelayUrl: () => "" }));

import { LiveCallSimulator } from "./LiveCallSimulator";

it("binds pending O2 only when the rendered I said this button is clicked", () => {
  render(createElement(LiveCallSimulator));
  const input = screen.getByLabelText("Prospect line");
  fireEvent.change(input, { target: { value: "Who’s this?" } });
  fireEvent.submit(input.closest("form")!);
  expect(screen.getAllByText("It’s Avery Test, founder of LotLift.").length).toBeGreaterThan(0);
  expect(screen.queryByText(/^REP:/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "I said this" }));
  expect(screen.getAllByText("It’s Avery Test, founder of LotLift.").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Rep (actual speech)").length).toBeGreaterThan(0);
});
