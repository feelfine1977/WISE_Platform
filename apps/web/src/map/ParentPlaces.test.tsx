import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as flow from "wise-flow";
import type { ComponentProps } from "react";
import type { ProcessMap } from "wise-flow/react";
import { MapView } from "./MapView";
import { BUSY_ACTIVITIES, busyGraph, shownWhole } from "./testGraphs";

type MapProps = ComponentProps<typeof ProcessMap>;
const drawn = vi.hoisted(() => ({ props: null as unknown }));

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

describe("#56 one arrangement of the parent, from its map thinned to the paths the map opens on", () => {
  it("places every activity of the parent, and leaves out of the arrangement the paths the opening detail leaves out", async () => {
    const supplied = busyGraph();
    render(<MapView shown={shownWhole(supplied)} parentGraph={supplied} onStep={() => undefined} initiallyInPlace />);
    await waitFor(() => expect(flow.layoutUnion).toHaveBeenCalledTimes(1));
    const [[scene]] = vi.mocked(flow.layoutUnion).mock.calls[0];
    // Every activity has its place, so an activity the detail brings back is placed where the arrangement put it.
    expect(scene.nodes.filter((node) => supplied.nodes.some((activity) => activity.id === node.id))).toHaveLength(BUSY_ACTIVITIES);
    // The paths the map opens without do not shape the places.
    const paths = scene.edges.filter((edge) => supplied.edges.some((path) => path.id === edge.id));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.length).toBeLessThan(supplied.edges.length);
    // The map reads its places from that arrangement.
    await waitFor(() => expect((drawn.props as MapProps | null)?.positions).toBeDefined());
  });
});
