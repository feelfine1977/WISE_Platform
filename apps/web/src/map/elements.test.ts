import { describe, expect, it } from "vitest";
import { emptySelection } from "wise-flow/react";
import { closed, contains, follows, nodeIds, opened, pathId, suppliedGraph } from "../test/selections";
import { selectedElement, stepChoices } from "./elements";

const graph = suppliedGraph(["A-1", "B-2"]);

describe("the element selected on the map", () => {
  it("is named by the supplied labels of an activity or a path", () => {
    expect(selectedElement(graph, emptySelection)).toBeNull();
    expect(selectedElement(graph, { nodes: [nodeIds[opened]], edges: [], groups: [] })).toEqual({ kind: "activity", label: opened });
    expect(selectedElement(graph, { nodes: [], edges: [pathId], groups: [] })).toEqual({ kind: "path", source: opened, target: closed, passages: 1, bridged: 0 });
  });

  it("offers no step for several elements or for a line that is no recorded path", () => {
    expect(selectedElement(graph, { nodes: [nodeIds[opened], nodeIds[closed]], edges: [], groups: [] })).toEqual({ kind: "several" });
    const indirect = `${nodeIds[opened]}->${nodeIds[closed]}:indirect`;
    const element = selectedElement(graph, { nodes: [], edges: [indirect], groups: [] });
    expect(element).toEqual({ kind: "unrecorded" });
    expect(stepChoices(element)).toEqual([]);
  });

  it("offers to keep the incidents through an activity or a path, or those not through it", () => {
    expect(stepChoices({ kind: "activity", label: opened })).toEqual([
      { label: "Keep incidents that contain it", step: contains(opened) },
      { label: "Keep incidents that do not contain it", step: contains(opened, true) },
    ]);
    expect(stepChoices({ kind: "path", source: opened, target: closed, passages: 1, bridged: 0 })).toEqual([
      { label: "Keep incidents where “Geschlossen” directly follows “Eröffnet”", step: follows(opened, closed) },
      { label: "Keep incidents where it never does", step: follows(opened, closed, true) },
    ]);
  });
});
