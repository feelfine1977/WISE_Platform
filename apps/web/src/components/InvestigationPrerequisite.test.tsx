import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ImportedInvestigationState } from "../imported/coordinator";
import { preparationId, workspaceId } from "../test/imports";
import { InvestigationPrerequisite } from "./InvestigationPrerequisite";

const target = { workspaceId, preparationId, sourceName: "S0.csv" };
const stateOf = (population: unknown, selection: unknown = { phase: "idle" }) => ({ population, selection }) as unknown as ImportedInvestigationState;

function show(state: ImportedInvestigationState, needsSelection = true) {
  const actions = { onShowData: vi.fn(), onShowInvestigation: vi.fn(), onRetryPopulation: vi.fn(), onRetrySelection: vi.fn() };
  render(<InvestigationPrerequisite state={state} purpose="An expectation is scored for the cases an investigation shows." needsSelection={needsSelection} {...actions} />);
  return { actions, user: userEvent.setup() };
}

describe("what an area waits for, and the action that works from there", () => {
  it("sends the analyst to the Data area while no reading is open", async () => {
    const { actions, user } = show(stateOf({ phase: "idle" }));
    expect(screen.getByText(/No cases are open at the moment/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Go to the Data area" }));
    expect(actions.onShowData).toHaveBeenCalledOnce();
  });

  it("says which reading is being opened, and shows the investigation on request", async () => {
    const { actions, user } = show(stateOf({ phase: "loading", revision: 1, target }));
    expect(screen.getByRole("status").textContent).toContain("The cases of S0.csv are being opened");
    await user.click(screen.getByRole("button", { name: "Show the investigation" }));
    expect(actions.onShowInvestigation).toHaveBeenCalledOnce();
  });

  it("names a failure to open the cases and offers to try again or to go to the Data area", async () => {
    const { actions, user } = show(stateOf({ phase: "failed", revision: 1, target, problem: { kind: "unreachable" } }));
    expect(screen.getByRole("alert").textContent).toContain("The cases could not be opened, so this area has nothing to work on.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await user.click(screen.getByRole("button", { name: "Go to the Data area" }));
    expect([actions.onRetryPopulation.mock.calls.length, actions.onShowData.mock.calls.length]).toEqual([1, 1]);
  });

  it("names a failure to select the cases where the area needs the selection, and retries the selection", async () => {
    const { actions, user } = show(stateOf({ phase: "ready" }, { phase: "failed", revision: 2, shown: null, problem: { kind: "unreachable" } }));
    expect(screen.getByRole("alert").textContent).toContain("The cases could not be selected");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(actions.onRetrySelection).toHaveBeenCalledOnce();
    expect(actions.onRetryPopulation).not.toHaveBeenCalled();
  });

  it("waits for the selection while it is answered", () => {
    show(stateOf({ phase: "ready" }, { phase: "loading", revision: 2, shown: null }));
    expect(screen.getByRole("status").textContent).toContain("The cases are being selected");
  });
});
