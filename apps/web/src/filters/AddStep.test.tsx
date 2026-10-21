import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SelectionPredicate } from "../generated/selection";
import { populationAnswer, preparationId, workspaceId } from "../test/imports";
import { openingContextAnswer } from "../test/views";
import { AddStep, STEP_GLOSS } from "./AddStep";

// #94: one "+ Add step" entry from which every kind of step starts; applying adds the step at once.
function start() {
  const population = populationAnswer({ schema_version: 1, message_type: "open_population_request", request_id: "o", query_revision: 1, workspace_id: workspaceId, preparation_id: preparationId });
  const opening = openingContextAnswer({ schema_version: 1, message_type: "opening_context_request", request_id: "c", query_revision: 1, workspace_id: workspaceId, identity: population.identity });
  const onStep = vi.fn<(step: SelectionPredicate) => void>();
  // The recorded range of the parent is never answered here: only the period needs it.
  const client = { list: vi.fn(() => new Promise<never>(() => undefined)) };
  render(<AddStep population={population} parentIds={null} parentIdentity={population.identity} revision={1} opening={{ phase: "ready", answer: opening }} onStep={onStep} client={client as never} />);
  return { onStep, user: userEvent.setup() };
}

describe("adding a step from one entry", () => {
  it("opens a short list of the kinds of step with the line that says what a step is", async () => {
    const { user } = start();
    const entry = screen.getByRole("button", { name: "+ Add step" });
    expect(entry.getAttribute("aria-expanded")).toBe("false");
    await user.click(entry);
    expect(entry.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByRole("group", { name: "Add a step" });
    expect(within(panel).getByText(STEP_GLOSS)).toBeTruthy();
    expect(within(within(panel).getByRole("list", { name: "Kinds of step" })).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Case numbers", "Recorded time", "A range of records, span or longest gap", "First record in a period", "Context values", "A range of a number in a context column",
    ]);
  });

  it("opens the form of a kind alone and adds its step at once, closing and giving the focus back to the entry", async () => {
    const { onStep, user } = start();
    await user.click(screen.getByRole("button", { name: "+ Add step" }));
    await user.click(screen.getByRole("button", { name: "Recorded time" }));
    const panel = screen.getByRole("group", { name: "Add a step" });
    // Only this kind's form, without the others.
    expect(within(panel).queryByText("Case numbers")).toBeNull();
    expect(within(panel).queryByRole("group", { name: /not yet taken/ })).toBeNull();
    await user.type(within(panel).getByLabelText("At least this many hours"), "4");
    await user.click(within(panel).getByRole("button", { name: "Keep by recorded time" }));
    expect(onStep).toHaveBeenCalledExactlyOnceWith({ kind: "observed_span_at_least", hours: 4, negate: false });
    expect(screen.queryByRole("group", { name: "Add a step" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "+ Add step" }));
  });

  it("goes back to the kinds, and closes on Escape", async () => {
    const { onStep, user } = start();
    await user.click(screen.getByRole("button", { name: "+ Add step" }));
    await user.click(screen.getByRole("button", { name: "Case numbers" }));
    await user.click(screen.getByRole("button", { name: "Other kinds of step" }));
    expect(screen.getByRole("list", { name: "Kinds of step" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Add a step" })).toBeNull();
    expect(onStep).not.toHaveBeenCalled();
  });
});
