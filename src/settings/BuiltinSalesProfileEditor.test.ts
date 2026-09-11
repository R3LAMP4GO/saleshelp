// @vitest-environment jsdom
import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

vi.mock("../lib/sales/customProfileStore", () => ({ loadSalesProfileOverrides: vi.fn(async () => []), saveSalesProfileOverrides: vi.fn(async () => undefined) }));
vi.mock("../lib/sales/knowledgeStore", () => ({ listKnowledgeSources: vi.fn(async () => []), importKnowledgePdf: vi.fn(async () => null) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import "../../sales-profiles/lotlift/profile";
import { BuiltinSalesProfileEditor } from "./BuiltinSalesProfileEditor";

it("offers accessible knowledge status, enablement, priority, ordering, import, and detach controls", async () => {
  render(createElement(BuiltinSalesProfileEditor));
  await waitFor(() => expect(screen.getAllByText("PDF not prepared", { exact: false })).toHaveLength(2));
  expect(screen.getAllByRole("button", { name: "Add PDF" })).toHaveLength(2);
  expect(screen.getAllByRole("checkbox", { name: "Use for new sessions" })).toHaveLength(2);
  const priorities = screen.getAllByRole("spinbutton", { name: "Priority (0–100)" });
  const user = userEvent.setup();
  await user.tripleClick(priorities[0]!);
  await user.keyboard("75");
  expect((screen.getAllByRole("spinbutton", { name: "Priority (0–100)" })[0] as HTMLInputElement).value).toBe("75");
  expect((screen.getByRole("button", { name: "Move objection strategy earlier" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getAllByRole("button", { name: "Detach" })[0]!);
  expect(screen.getByText("objection strategy is detached.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Attach again" }));
  expect(screen.getAllByRole("button", { name: "Add PDF" })).toHaveLength(2);
  expect(screen.getByText(/strategy context to new sessions only/i)).toBeTruthy();
});
