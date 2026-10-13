import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ProcessMap } from "wise-flow/react";
import { suppliedGraph } from "../test/selections";
import { CANVAS_FROM } from "./detail";
import { MapView } from "./MapView";
import { crowdedGraph, shownWhole } from "./testGraphs";

type MapProps = ComponentProps<typeof ProcessMap>;

const drawn = vi.hoisted(() => ({ props: null as unknown }));

// The map is not drawn here: what it is given is kept, so that it can be read where its detail controls are asked for.
vi.mock("wise-flow/react", async (original) => {
  const library = await original<typeof import("wise-flow/react")>();
  return {
    ...library,
    ProcessMap: (props: MapProps) => {
      drawn.props = props;
      return null;
    },
  };
});

const asked = () => drawn.props as MapProps;
const controls = () => screen.queryByRole("form", { name: "Detail" });
const slider = (name: "Activities" | "Paths") => within(controls()!).getByRole("slider", { name }) as HTMLInputElement;
const move = (name: "Activities" | "Paths", to: number) => fireEvent.change(slider(name), { target: { value: String(to) } });

describe("the place of the detail controls", () => {
  it("is above the canvas for a map drawn as elements, which is given a detail and a view from the start and no panel of its own", () => {
    const graph = suppliedGraph(["A-1", "B-2"]);
    render(<MapView shown={shownWhole(graph)} parentGraph={graph} onStep={() => undefined} />);
    expect(controls()).not.toBeNull();
    expect(asked().controls).toBe(false);
    // A map of few activities and paths opens whole. It is still given that detail, so that it holds none of its own.
    expect(asked().abstraction).toEqual({});
    expect(asked().view).toBe("map");
    expect(asked().canvasThreshold).toBe(CANVAS_FROM);
    // Every path the detail selects is drawn: the controls say no other number.
    expect(asked().edgeBudget).toBe("all");

    fireEvent.click(within(controls()!).getByRole("button", { name: "Table view" }));
    expect(asked().view).toBe("table");
    act(() => asked().onViewChange?.("map"));
    expect(within(controls()!).getByRole("button", { name: "Table view" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("is the map library's own panel inside the map once it draws so much that it draws on its Canvas, and above the canvas again below that", () => {
    const graph = crowdedGraph();
    render(<MapView shown={shownWhole(graph)} parentGraph={graph} onStep={() => undefined} />);
    // 50 activities and 2,450 paths open on the 20 most frequent activities and 30 paths.
    expect(asked().abstraction).toEqual({ activityDetail: 20 / 50, pathDetail: 30 / 2450, edgeMetric: "cases" });
    expect(asked().controls).toBe(false);
    expect(controls()).not.toBeNull();

    move("Activities", 50);
    move("Paths", 1945);
    // Start, End and the 50 activities with 1,948 flows and paths: 2,000 elements, as many as the library still draws as elements.
    expect(asked().controls).toBe(false);
    expect(slider("Paths").getAttribute("aria-valuetext")).toBe("1,948 of 2,452 · 1 kept · strongest not shown: 32");

    move("Paths", 1946);
    expect(asked().controls).toBe(true);
    expect(controls()).toBeNull();
    // On its Canvas the library decides by the zoom how many paths it draws, and its own panel says how many.
    expect(asked().edgeBudget).toBe("adaptive");

    // The library's panel moves the same detail; below the number the controls stand above the canvas again.
    act(() => asked().onAbstractionChange?.({ ...asked().abstraction, pathDetail: 1000 / 2450 }));
    expect(asked().controls).toBe(false);
    expect(slider("Paths").value).toBe("1000");
  });
});
