import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as flow from "wise-flow";
import type { ProcessMap } from "wise-flow/react";
import type { SelectCasesRequest } from "../generated/selection";
import { identity, workspaceId } from "../test/imports";
import { everyIncident, nodeIds, opened, selectionAnswer, suppliedGraph } from "../test/selections";
import { FIRST_ACTIVITY, LEFT_TO_RIGHT, OPENING_DIRECTION, TOP_TO_BOTTOM } from "./arrange";
import { MapView } from "./MapView";

type MapProps = ComponentProps<typeof ProcessMap>;

const drawn = vi.hoisted(() => ({ props: null as unknown }));

// The map is not drawn here: what it is given is kept, so that the arrangement it is asked for can be read.
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

vi.mock("wise-flow", async (original) => {
  const library = await original<typeof import("wise-flow")>();
  return { ...library, layoutUnion: vi.fn(library.layoutUnion) };
});

beforeEach(() => {
  drawn.props = null;
  vi.mocked(flow.layoutUnion).mockClear();
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

const asked = () => drawn.props as MapProps | null;

/** How a map that runs from top to bottom is arranged, whoever arranges it. */
const fromTopToBottom = { direction: TOP_TO_BOTTOM, spacing: { node: 24, layer: 48 }, edgeRouting: "ORTHOGONAL" };

describe("the arrangement the map is asked for", () => {
  // Both incidents: A-1 begins with "Eröffnet", the only activity Start leads to.
  const graph = suppliedGraph(["A-1", "B-2"]);
  const shown = { revision: 1, steps: [], answer: selectionAnswer(request, everyIncident), graph };

  it("runs from top to bottom, with Start's target named as the first activity", () => {
    expect(OPENING_DIRECTION).toBe(TOP_TO_BOTTOM);
    render(<MapView shown={shown} parentGraph={graph} onStep={() => undefined} />);
    expect(asked()?.layout).toMatchObject(fromTopToBottom);
    expect(asked()?.layout?.elkOptions).toEqual({ [FIRST_ACTIVITY]: nodeIds[opened] });
    // The engine is the application's own; the fallback keeps the worker the application serves for it.
    expect(asked()?.layout?.elk).toBeDefined();
    expect(asked()?.layout?.dagreWorkerUrl).toBeTypeOf("string");
    expect(asked()?.positions).toBeUndefined();
    expect(flow.layoutUnion).not.toHaveBeenCalled();
  });

  it("arranges the whole parent the same way, and gives the map its places", async () => {
    render(<MapView shown={shown} parentGraph={graph} onStep={() => undefined} initiallyInPlace />);
    expect(flow.layoutUnion).toHaveBeenCalledTimes(1);
    const [, parentLayout] = vi.mocked(flow.layoutUnion).mock.calls[0];
    expect(parentLayout).toMatchObject(fromTopToBottom);
    expect(parentLayout?.elkOptions).toEqual({ [FIRST_ACTIVITY]: nodeIds[opened] });
    // Another engine than the map's: no arrangement of a parent is ended for a newer arrangement of the map.
    await waitFor(() => expect(asked()?.positions).toBeDefined());
    expect(parentLayout?.elk).not.toBe(asked()?.layout?.elk);
    expect(asked()?.positions).toMatchObject({ engine: "elk", direction: TOP_TO_BOTTOM });
    expect(asked()?.layout).toMatchObject(fromTopToBottom);
  });

  it("runs left to right from the switch in the map's tools, the map and the whole parent alike, and back again", async () => {
    const user = userEvent.setup();
    render(<MapView shown={shown} parentGraph={graph} onStep={() => undefined} initiallyInPlace />);
    const toggle = screen.getByRole("button", { name: "Run the map left to right" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    // The whole parent is arranged anew the other way, and the map waits for its places.
    await waitFor(() => expect(vi.mocked(flow.layoutUnion).mock.calls.at(-1)?.[1]).toMatchObject({ direction: LEFT_TO_RIGHT }));
    await waitFor(() => expect(asked()?.layout).toMatchObject({ ...fromTopToBottom, direction: LEFT_TO_RIGHT }));
    expect(document.querySelector(".map-frame")?.getAttribute("data-direction")).toBe(LEFT_TO_RIGHT);
    await user.click(toggle);
    await waitFor(() => expect(asked()?.layout).toMatchObject(fromTopToBottom));
  });
});

describe("what stays in view above the map", () => {
  const limit = () => document.querySelector(".map-basis-limit");
  const tag = () => document.querySelector(".map-basis-tag");

  it("says how many incidents are not evaluable for paths while there are any, without opening About this map", () => {
    const graph = suppliedGraph(["A-1", "B-2"]);
    render(<MapView shown={{ revision: 1, steps: [], answer: selectionAnswer(request, everyIncident), graph }} parentGraph={graph} onStep={() => undefined} />);
    expect(limit()?.textContent).toBe("1 incident not evaluable for paths");
    expect(tag()).toBeNull();
  });

  it("says nothing there when every incident is evaluable and times are UTC instants", () => {
    const graph = suppliedGraph(["A-1"]);
    render(<MapView shown={{ revision: 1, steps: [], answer: selectionAnswer(request, everyIncident), graph }} parentGraph={graph} onStep={() => undefined} />);
    expect(document.querySelector(".map-basis")).toBeNull();
  });

  it("tags times read as recorded as the wall clock, with its limitation as the tooltip", () => {
    const utc = suppliedGraph(["A-1"]);
    const limitation = "Recorded local times without a time zone; hours across a clock change may be off by one.";
    const graph = { ...utc, meta: { ...utc.meta, timestamp_kind: "wall_clock" as const, lag_clock: "recorded_wall_clock_hours" as const, clock_limitation: limitation } };
    render(<MapView shown={{ revision: 1, steps: [], answer: selectionAnswer(request, everyIncident), graph }} parentGraph={graph} onStep={() => undefined} />);
    expect(tag()?.textContent).toBe("Wall clock");
    expect(tag()?.getAttribute("title")).toBe(limitation);
    expect(limit()).toBeNull();
  });
});
