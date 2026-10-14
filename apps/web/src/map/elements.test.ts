import { describe, expect, it } from "vitest";
import { emptySelection } from "wise-flow/react";
import { begins, checked, closed, contains, ends, follows, nodeIds, opened, pathId, suppliedGraph } from "../test/selections";
import { elementOf, selectedElement, stepChoices } from "./elements";
import { END_ID, endFlowId, START_ID, startFlowId, toFlowGraph } from "./graph";

const graph = suppliedGraph(["A-1", "B-2"]);
/** The times of an activity no path leads into or out of. */
const noPassage = { usablePreviousCount: 0, usableNextCount: 0 };

describe("the element selected on the map", () => {
  it("is named by the supplied labels of an activity or a path", () => {
    expect(selectedElement(graph, emptySelection)).toBeNull();
    expect(selectedElement(graph, { nodes: [nodeIds[opened]], edges: [], groups: [] })).toEqual({
      kind: "activity",
      id: nodeIds[opened],
      label: opened,
      starts: 1,
      ends: 0,
      times: { usablePreviousCount: 0, medianNextHours: 25.5, usableNextCount: 1 },
    });
    expect(selectedElement(graph, { nodes: [nodeIds[closed]], edges: [], groups: [] })).toEqual({
      kind: "activity",
      id: nodeIds[closed],
      label: closed,
      starts: 0,
      ends: 1,
      times: { medianPreviousHours: 25.5, usablePreviousCount: 1, usableNextCount: 0 },
    });
    expect(selectedElement(graph, { nodes: [], edges: [pathId], groups: [] })).toEqual({ kind: "path", source: opened, target: closed, passages: 1, bridged: 0 });
  });

  it("carries the supplied times of an activity, and no time where none is supplied", () => {
    const begun = elementOf(graph, "node", nodeIds[opened]);
    const alone = elementOf(graph, "node", nodeIds[checked]);
    // A time that is not supplied is left out: it is not a time of nothing.
    expect(begun).toStrictEqual({ kind: "activity", id: nodeIds[opened], label: opened, starts: 1, ends: 0, times: { usablePreviousCount: 0, medianNextHours: 25.5, usableNextCount: 1 } });
    expect(alone).toStrictEqual({ kind: "activity", id: nodeIds[checked], label: checked, starts: 0, ends: 0, times: noPassage });
  });

  it("offers no step for several elements or for a line that is no recorded path", () => {
    expect(selectedElement(graph, { nodes: [nodeIds[opened], nodeIds[closed]], edges: [], groups: [] })).toEqual({ kind: "several" });
    const indirect = `${nodeIds[opened]}->${nodeIds[closed]}:indirect`;
    const element = selectedElement(graph, { nodes: [], edges: [indirect], groups: [] });
    expect(element).toEqual({ kind: "unrecorded" });
    expect(stepChoices(element)).toEqual([]);
  });

  it("offers to keep the incidents through an activity or a path, or those not through it", () => {
    expect(stepChoices({ kind: "activity", id: nodeIds[opened], label: opened, starts: 0, ends: 0, times: noPassage })).toEqual([
      { label: "Keep incidents that contain it", step: contains(opened) },
      { label: "Keep incidents that do not contain it", step: contains(opened, true) },
    ]);
    expect(stepChoices({ kind: "path", source: opened, target: closed, passages: 1, bridged: 0 })).toEqual([
      { label: "Keep incidents where “Geschlossen” directly follows “Eröffnet”", step: follows(opened, closed) },
      { label: "Keep incidents where it never does", step: follows(opened, closed, true) },
    ]);
  });

  it("names a flow the map adds from Start or to End by the activity incidents begin or end with", () => {
    expect(selectedElement(graph, { nodes: [], edges: [startFlowId(nodeIds[opened])], groups: [] })).toEqual({
      kind: "boundary",
      side: "start",
      activity: opened,
      incidents: 1,
    });
    expect(elementOf(graph, "edge", endFlowId(nodeIds[closed]))).toEqual({ kind: "boundary", side: "end", activity: closed, incidents: 1 });
    // Every flow the map adds is found in the supplied graph, and with the supplied number of incidents.
    const added = toFlowGraph(graph).edges.filter((edge) => edge.kind === "flow");
    expect(added.map((edge) => edge.id)).toEqual([startFlowId(nodeIds[opened]), endFlowId(nodeIds[closed])]);
    for (const edge of added) expect(elementOf(graph, "edge", edge.id)).toMatchObject({ kind: "boundary", incidents: edge.metrics?.cases });
  });

  it("offers no step for a flow the map does not draw, or for Start and End themselves", () => {
    // No incident begins with "Geschlossen" and none ends with "Eröffnet" or "Prüfung".
    expect(elementOf(graph, "edge", startFlowId(nodeIds[closed]))).toEqual({ kind: "unrecorded" });
    expect(elementOf(graph, "edge", endFlowId(nodeIds[opened]))).toEqual({ kind: "unrecorded" });
    expect(elementOf(graph, "edge", endFlowId(nodeIds[checked]))).toEqual({ kind: "unrecorded" });
    expect(elementOf(graph, "edge", startFlowId("activity.v1:sha256:unknown"))).toEqual({ kind: "unrecorded" });
    expect(elementOf(graph, "node", START_ID)).toEqual({ kind: "unrecorded" });
    expect(elementOf(graph, "node", END_ID)).toEqual({ kind: "unrecorded" });
    expect(stepChoices({ kind: "unrecorded" })).toEqual([]);
  });

  it("offers to keep the incidents that begin or end with the activity of a flow, or those that do not", () => {
    expect(stepChoices(elementOf(graph, "edge", startFlowId(nodeIds[opened])))).toEqual([
      { label: "Keep incidents that begin with it", step: begins(opened) },
      { label: "Keep incidents that do not begin with it", step: begins(opened, true) },
    ]);
    expect(stepChoices(elementOf(graph, "edge", endFlowId(nodeIds[closed])))).toEqual([
      { label: "Keep incidents that end with it", step: ends(closed) },
      { label: "Keep incidents that do not end with it", step: ends(closed, true) },
    ]);
  });

  it("offers the beginning and the end of an activity after its own steps, only where incidents begin or end with it", () => {
    const own = (activity: string) => [
      { label: "Keep incidents that contain it", step: contains(activity) },
      { label: "Keep incidents that do not contain it", step: contains(activity, true) },
    ];
    expect(stepChoices(elementOf(graph, "node", nodeIds[opened]))).toEqual([...own(opened), { label: "Keep incidents that begin with it", step: begins(opened) }]);
    expect(stepChoices(elementOf(graph, "node", nodeIds[closed]))).toEqual([...own(closed), { label: "Keep incidents that end with it", step: ends(closed) }]);
    // No incident whose order is known begins or ends with "Prüfung".
    expect(stepChoices(elementOf(graph, "node", nodeIds[checked]))).toEqual(own(checked));
    expect(stepChoices({ kind: "activity", id: nodeIds[checked], label: checked, starts: 2, ends: 3, times: noPassage })).toEqual([
      ...own(checked),
      { label: "Keep incidents that begin with it", step: begins(checked) },
      { label: "Keep incidents that end with it", step: ends(checked) },
    ]);
  });
});
