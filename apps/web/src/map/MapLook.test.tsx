import { render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as flow from "wise-flow";
import type * as FlowReact from "wise-flow/react";
import { END_ID, START_ID } from "./graph";
import { MAP_THEME, nodeSize } from "./look";
import { MapView } from "./MapView";
import { busyGraph, shownWhole } from "./testGraphs";

type MapProps = ComponentProps<typeof FlowReact.ProcessMap>;

const drawn = vi.hoisted(() => ({ props: null as unknown, real: true }));

// The map is drawn as it is, or not at all: then what it is given is kept, so that it can be read.
vi.mock("wise-flow/react", async (original) => {
  const library = await original<typeof FlowReact>();
  return {
    ...library,
    ProcessMap: (props: MapProps) => {
      drawn.props = props;
      return drawn.real ? <library.ProcessMap {...props} /> : null;
    },
  };
});

vi.mock("wise-flow", async (original) => {
  const library = await original<typeof import("wise-flow")>();
  return { ...library, layoutUnion: vi.fn(library.layoutUnion) };
});

// The map measures its container; the test page has no layout, so nothing is ever resized.
class StillObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StillObserver;

beforeEach(() => {
  drawn.props = null;
  drawn.real = true;
  vi.mocked(flow.layoutUnion).mockClear();
});

const asked = () => drawn.props as MapProps;
const supplied = busyGraph();

describe("the look the map is given", () => {
  it("is the theme of the map and the sizes of its nodes, for the map and for the arrangement of the whole parent alike", () => {
    drawn.real = false;
    render(<MapView shown={shownWhole(supplied)} parentGraph={supplied} onStep={() => undefined} initiallyInPlace />);
    expect(flow.layoutUnion).toHaveBeenCalledTimes(1);
    expect(vi.mocked(flow.layoutUnion).mock.calls[0][1]?.nodeSize).toBe(nodeSize);
    render(<MapView shown={shownWhole(supplied)} parentGraph={supplied} onStep={() => undefined} />);
    expect(asked().theme).toBe(MAP_THEME);
    expect(asked().layout?.nodeSize).toBe(nodeSize);
  });

  it("says on the frame of the map which way it runs, for the stylesheet of its look", async () => {
    render(<MapView shown={shownWhole(supplied)} parentGraph={supplied} onStep={() => undefined} />);
    const map = await screen.findByLabelText("Process map of the kept incidents");
    expect(map.closest(".map-frame")?.getAttribute("data-direction")).toBe("DOWN");
  });

  it("draws Start as a ring and End as a disc in their colours, with their names", async () => {
    render(<MapView shown={shownWhole(supplied)} parentGraph={supplied} onStep={() => undefined} />);
    const map = await screen.findByLabelText("Process map of the kept incidents");
    await waitFor(() => expect(map.getAttribute("data-layout-status")).toBe("ready"));
    const node = (id: string) => map.querySelector<HTMLElement>(`[id="wf-node-${id}"]`)!;
    const paints = (id: string) => ["--wf-node-fill", "--wf-node-outline", "--wf-node-stroke", "--wf-node-radius"].map((name) => node(id).style.getPropertyValue(name));
    expect(paints(START_ID)).toEqual(["#ffffff", "#205840", "2px", "20px"]);
    expect(paints(END_ID)).toEqual(["#803068", "#803068", "2px", "20px"]);
    for (const id of [START_ID, END_ID]) {
      const name = node(id).querySelector<HTMLElement>('[data-wf-part="node-label"]')!;
      expect(name.textContent).toBe(id === START_ID ? "Start" : "End");
      expect([name.style.getPropertyValue("--wf-text-size"), name.style.getPropertyValue("--wf-text-weight")]).toEqual(["15px", "600"]);
    }
  });
});
