import { act, render } from "@testing-library/react";
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
    expect(asked().style).toBeUndefined();
    // The map offers its measures only to a host that listens for the choice.
    expect(asked().onMeasureChange).toBeTypeOf("function");
    expect(asked().legend).toBe(true);
    const counted = theRest(asked());

    act(() => asked().onMeasureChange?.("performance"));
    expect(asked().measure).toBe("performance");
    // Over the library's own performance style: a dash where no time until the next event is supplied.
    expect(asked().style).toEqual({ nodeLine: { metric: "medianNextHours", missing: "dash" } });
    // The same graph, arrangement, detail, panels and menu: only what is written on the map changes.
    expect(theRest(asked())).toEqual(counted);
    expect(asked().graph).toBe(counted.graph);
    expect(asked().layoutResetKey).toBe(counted.layoutResetKey);

    act(() => asked().onMeasureChange?.("frequency"));
    expect(asked().measure).toBe("frequency");
    expect(asked().style).toBeUndefined();
  });
});
