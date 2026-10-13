import { render, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as flow from "wise-flow";
import type { ProcessMap } from "wise-flow/react";
import type { SelectCasesRequest } from "../generated/selection";
import { identity, workspaceId } from "../test/imports";
import { everyIncident, nodeIds, opened, selectionAnswer, suppliedGraph } from "../test/selections";
import { FIRST_ACTIVITY, OPENING_DIRECTION, TOP_TO_BOTTOM } from "./arrange";
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
});
