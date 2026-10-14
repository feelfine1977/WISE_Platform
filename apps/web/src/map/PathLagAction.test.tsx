import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { suppliedGraph, opened, closed } from "../test/selections";
import { MapView } from "./MapView";
import { shownWhole } from "./testGraphs";

class StillObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StillObserver;

describe("a supplied path's lag action in the shared map and list card", () => {
  it("submits one typed inclusive step and keeps it disabled while another selection is pending", () => {
    const graph = suppliedGraph(["A-1", "B-2"]), shown = shownWhole(graph), onStep = vi.fn();
    const view = (showing: "map" | "paths", waitingFor?: string) => <MapView shown={shown} parentGraph={graph} showing={showing} waitingFor={waitingFor} onStep={onStep} />;
    const { rerender } = render(view("paths"));
    fireEvent.click(screen.getByRole("button", { name: `Path from “${opened}” to “${closed}”` }));
    fireEvent.click(screen.getByText("Path lag range"));
    const form = screen.getByRole("form", { name: `Lag range from ${opened} to ${closed}` });
    fireEvent.change(within(form).getByLabelText("Lower lag bound (included), hours"), { target: { value: "1" } });
    fireEvent.change(within(form).getByLabelText("Upper lag bound (included), hours"), { target: { value: "30" } });
    fireEvent.change(within(form).getByLabelText("Passages required"), { target: { value: "every" } });
    fireEvent.change(within(form).getByLabelText("Path range action"), { target: { value: "remove" } });
    fireEvent.click(within(form).getByRole("button", { name: "Remove by path lag" }));
    expect(onStep.mock.calls).toEqual([[{ kind: "directly_follows_lag_between", source_activity: opened, target_activity: closed, minimum_hours: 1, maximum_hours: 30, quantifier: "every", negate: true }]]);
    rerender(view("map", "pending-selection"));
    const pending = screen.getByRole("form", { name: `Lag range from ${opened} to ${closed}` });
    const apply = within(pending).getByRole("button", { name: "Remove by path lag" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(apply.getAttribute("aria-describedby")).toBe("pending-selection");
    fireEvent.click(apply);
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  it("offers the range only for an actual path, and clears it when a boundary flow is selected", () => {
    const graph = suppliedGraph(["A-1"]);
    render(<MapView shown={shownWhole(graph)} parentGraph={graph} showing="paths" onStep={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: `Path from “${opened}” to “${closed}”` }));
    expect(screen.getByText("Path lag range")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Flow from Start to “${opened}”` }));
    expect(screen.queryByText("Path lag range")).toBeNull();
  });
});
