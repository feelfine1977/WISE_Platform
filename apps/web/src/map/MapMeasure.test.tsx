import { act, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ProcessMap } from "wise-flow/react";
import type { SelectCasesRequest } from "../generated/selection";
import { identity, workspaceId } from "../test/imports";
import { everyIncident, selectionAnswer, suppliedGraph } from "../test/selections";
import { MapView } from "./MapView";

type MapProps = ComponentProps<typeof ProcessMap>;

const drawn = vi.hoisted(() => ({ props: null as unknown }));

// The map is not drawn here: what it is given is kept, so that the measure it is asked for can be read.
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

const request: SelectCasesRequest = {
  schema_version: 1,
  message_type: "select_cases_request",
  request_id: "select-1",
  query_revision: 1,
  workspace_id: workspaceId,
  identity,
  parent_case_ids: null,
  predicates: [],
};

const asked = () => drawn.props as MapProps;

/** What the map is asked for besides its measure: the same before and after a measure is chosen. */
const theRest = ({ measure: _measure, style: _style, ...rest }: MapProps) => rest;

describe("the measure the map is asked for", () => {
  it("is the counts at first, and the performance measure once the analyst chooses it on the map", () => {
    const graph = suppliedGraph(["A-1", "B-2"]);
    render(<MapView shown={{ revision: 1, steps: [], answer: selectionAnswer(request, everyIncident), graph }} parentGraph={graph} onStep={() => undefined} />);
    expect(asked().measure).toBe("frequency");
    // Over the library's own style of the counts: only the widths of the paths.
    expect(asked().style).toEqual({ edgeWidth: { metric: "cases", range: [1, 6] } });
    // The canvas is the map's alone (#54): its detail controls, its legend and the list of the paths of an activity stand
    // outside it, and the measure is chosen there.
    expect(asked().controls).toBe(false);
    expect(asked().legend).toBe(false);
    expect(asked().pathList).toBe(false);
    expect(asked().onMeasureChange).toBeUndefined();
    const counted = theRest(asked());

    act(() => screen.getByRole("button", { name: "Time on the map" }).click());
    expect(asked().measure).toBe("performance");
    // Over the library's own performance style: the same widths, a dash where no time until the next event is supplied, and the lag in classes (#86).
    expect(asked().style).toEqual({ edgeWidth: { metric: "cases", range: [1, 6] }, nodeLine: { metric: "medianNextHours", missing: "dash" }, edgeColor: { bins: [24, 168] } });
    // The same graph, arrangement, detail, panels and menu: only what is written on the map changes.
    expect(theRest(asked())).toEqual(counted);
    expect(asked().graph).toBe(counted.graph);
    expect(asked().layoutResetKey).toBe(counted.layoutResetKey);

    act(() => screen.getByRole("button", { name: "Cases on the map" }).click());
    expect(asked().measure).toBe("frequency");
    expect(asked().style).toEqual({ edgeWidth: { metric: "cases", range: [1, 6] } });
  });
});

describe("the paths of an activity asked for on the map", () => {
  it("are listed beside the map with the activity's steps and times, not on the canvas", () => {
    const graph = suppliedGraph(["A-1", "B-2"]);
    render(<MapView shown={{ revision: 1, steps: [], answer: selectionAnswer(request, everyIncident), graph }} parentGraph={graph} onStep={() => undefined} />);
    expect(asked().pathList).toBe(false);
    const activity = graph.nodes[0];
    act(() => asked().onFocusChange?.(activity.id));
    // The activity is selected: the panel beside the map is shown, with its paths in and out.
    const panel = document.querySelector(".map-element")!;
    expect(panel.classList.contains("visually-hidden")).toBe(false);
    expect(asked().selection).toEqual({ nodes: [activity.id], edges: [], groups: [] });
    expect(screen.getAllByRole("region", { name: new RegExp(`^Paths (in|out) of ${activity.label}$`) }).length).toBeGreaterThan(0);
    // The paths between two activities select the path between them.
    const edge = graph.edges[0];
    act(() => asked().onFocusChange?.([edge.source, edge.target]));
    expect(asked().selection).toEqual({ nodes: [], edges: [edge.id], groups: [] });
  });
});
