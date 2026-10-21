import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MenuAction, MenuTarget } from "wise-flow";
import type { ProcessMap } from "wise-flow/react";
import type { SelectCasesRequest } from "../generated/selection";
import { identity, workspaceId } from "../test/imports";
import { begins, checked, closed, contains, ends, everyIncident, follows, nodeIds, opened, pathId, selectionAnswer, suppliedGraph } from "../test/selections";
import { END_ID, endFlowId, START_ID, startFlowId } from "./graph";
import { MapView } from "./MapView";

type MapProps = ComponentProps<typeof ProcessMap>;

const drawn = vi.hoisted(() => ({ props: null as unknown }));

// The map is not drawn here: what it is given is kept, so that its actions menu can be asked for any element, also for a line.
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

/** What the map library offers by itself: a filter of the picture, which is left out, and the paths of an element, which stay. */
const ofTheLibrary: MenuAction[] = [
  { id: "filter-to", label: "Filter to this", group: "filter" },
  { id: "paths", label: "Show its paths", group: "explore" },
];

/** The map of both incidents: A-1 begins with "Eröffnet" and ends with "Geschlossen"; the order of B-2 is not known. */
function renderMap(waitingFor?: string) {
  const graph = suppliedGraph(["A-1", "B-2"]);
  const onStep = vi.fn();
  render(
    <MapView shown={{ revision: 1, steps: [], answer: selectionAnswer(request, everyIncident), graph }} parentGraph={graph} onStep={onStep} waitingFor={waitingFor} />,
  );
  const menu = (kind: MenuTarget["kind"], id: string, library = ofTheLibrary) => {
    const target: MenuTarget = { kind, id, ids: [id], label: id };
    const actions = (drawn.props as MapProps).onContextMenu?.(target, library);
    return { target, actions: actions || [], labels: actions ? actions.map((action) => action.label) : false };
  };
  return { onStep, menu };
}

describe("the actions menu of the map", () => {
  it("offers a flow from Start the cases that begin with its activity, and those that do not", () => {
    const { onStep, menu } = renderMap();
    const { target, actions, labels } = menu("edge", startFlowId(nodeIds[opened]));
    expect(labels).toEqual(["Keep cases that begin with it", "Keep cases that do not begin with it", "Show its paths"]);
    actions[0].run?.(target);
    actions[1].run?.(target);
    expect(onStep.mock.calls).toEqual([[begins(opened)], [begins(opened, true)]]);
  });

  it("offers a flow to End the cases that end with its activity, and those that do not", () => {
    const { onStep, menu } = renderMap();
    const { target, actions, labels } = menu("edge", endFlowId(nodeIds[closed]));
    expect(labels).toEqual(["Keep cases that end with it", "Keep cases that do not end with it", "Show its paths"]);
    actions[0].run?.(target);
    actions[1].run?.(target);
    expect(onStep.mock.calls).toEqual([[ends(closed)], [ends(closed, true)]]);
  });

  it("offers an activity its own steps first, then its beginning or its end where cases begin or end with it", () => {
    const { onStep, menu } = renderMap();
    const own = ["Keep cases that contain it", "Keep cases that do not contain it"];
    const begun = menu("node", nodeIds[opened]);
    expect(begun.labels).toEqual([...own, "Keep cases that begin with it", "Show its paths"]);
    const ended = menu("node", nodeIds[closed]);
    expect(ended.labels).toEqual([...own, "Keep cases that end with it", "Show its paths"]);
    // No incident whose order is known begins or ends with "Prüfung".
    expect(menu("node", nodeIds[checked]).labels).toEqual([...own, "Show its paths"]);
    begun.actions[0].run?.(begun.target);
    begun.actions[2].run?.(begun.target);
    ended.actions[2].run?.(ended.target);
    expect(onStep.mock.calls).toEqual([[contains(opened)], [begins(opened)], [ends(closed)]]);
  });

  it("keeps the steps of a recorded path as they were", () => {
    const { onStep, menu } = renderMap();
    const { target, actions, labels } = menu("edge", pathId);
    expect(labels).toEqual(["Keep cases where “Geschlossen” directly follows “Eröffnet”", "Keep cases where it never does", "Show its paths"]);
    actions[1].run?.(target);
    expect(onStep.mock.calls).toEqual([[follows(opened, closed, true)]]);
  });

  it("offers no step for Start and End themselves, for a flow the map does not draw, or while no step can be taken", () => {
    const { menu } = renderMap();
    expect(menu("node", START_ID).labels).toEqual(["Show its paths"]);
    expect(menu("node", END_ID).labels).toEqual(["Show its paths"]);
    expect(menu("edge", startFlowId(nodeIds[closed])).labels).toEqual(["Show its paths"]);
    expect(menu("edge", endFlowId(nodeIds[opened]), []).labels).toBe(false);

    const waiting = renderMap("why-no-step");
    expect(waiting.menu("edge", startFlowId(nodeIds[opened])).labels).toEqual(["Show its paths"]);
    expect(waiting.menu("node", nodeIds[opened]).labels).toEqual(["Show its paths"]);
  });
});
