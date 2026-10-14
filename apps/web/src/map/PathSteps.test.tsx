import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MenuTarget } from "wise-flow";
import type { ProcessMap } from "wise-flow/react";
import { closed, nodeIds, opened, pathId, suppliedGraph } from "../test/selections";
import { endFlowId, startFlowId } from "./graph";
import { MapView } from "./MapView";
import { shownWhole } from "./testGraphs";

type MapProps = ComponentProps<typeof ProcessMap>;

const drawn = vi.hoisted(() => ({ props: null as unknown }));

// The map is not drawn here: what it is given is kept, so that its actions menu can be asked for a path and for a flow.
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

describe("the steps of a row of the list of every path", () => {
  it("are the steps the map's menu offers for the same path or flow, and take the same step", () => {
    const graph = suppliedGraph(["A-1", "B-2"]);
    const onMap = vi.fn();
    const onList = vi.fn();
    const { rerender } = render(<MapView shown={shownWhole(graph)} parentGraph={graph} onStep={onMap} />);
    const menuOf = (id: string) => {
      const target: MenuTarget = { kind: "edge", id, ids: [id], label: id };
      return { target, actions: (drawn.props as MapProps).onContextMenu?.(target, []) || [] };
    };
    const menus = [
      ["Path from “Eröffnet” to “Geschlossen”", menuOf(pathId)],
      ["Flow from Start to “Eröffnet”", menuOf(startFlowId(nodeIds[opened]))],
      ["Flow from “Geschlossen” to End", menuOf(endFlowId(nodeIds[closed]))],
    ] as const;

    rerender(<MapView shown={shownWhole(graph)} parentGraph={graph} onStep={onList} showing="paths" />);
    const list = screen.getByRole("table", { name: "Paths of the kept incidents" });
    for (const [row, menu] of menus) {
      fireEvent.click(within(list).getByRole("button", { name: row }));
      const offered = Array.from(document.querySelectorAll<HTMLButtonElement>(".map-choices button"));
      expect(offered.map((button) => button.textContent)).toEqual(menu.actions.map((action) => action.label));
      expect(offered).toHaveLength(2);
      offered.forEach((button, place) => {
        onMap.mockClear();
        onList.mockClear();
        menu.actions[place].run?.(menu.target);
        fireEvent.click(button);
        expect(onList.mock.calls).toEqual(onMap.mock.calls);
        expect(onList).toHaveBeenCalledTimes(1);
      });
    }
  });

  it("are not taken while no step can be taken, as on the map", () => {
    const graph = suppliedGraph(["A-1", "B-2"]);
    const onStep = vi.fn();
    render(
      <>
        <p id="why-no-step">Another question is opening.</p>
        <MapView shown={shownWhole(graph)} parentGraph={graph} onStep={onStep} waitingFor="why-no-step" showing="paths" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Path from “Eröffnet” to “Geschlossen”" }));
    const offered = Array.from(document.querySelectorAll<HTMLButtonElement>(".map-choices button"));
    expect(offered.map((button) => [button.disabled, button.getAttribute("aria-describedby")])).toEqual([
      [true, "why-no-step"],
      [true, "why-no-step"],
    ]);
    offered.forEach((button) => fireEvent.click(button));
    expect(onStep).not.toHaveBeenCalled();
  });
});
