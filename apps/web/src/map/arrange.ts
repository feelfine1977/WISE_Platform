import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import type { FlowEdge, FlowGraph, LayoutOptions } from "wise-flow";
import dagreWorkerUrl from "wise-flow/dagre-worker.min.js?url";
import elkWorkerUrl from "wise-flow/elk-worker.min.js?url";
import { END_ID, START_ID } from "./graph";

/*
 * How the map is arranged: which way it runs, and Start first, End last.
 *
 * A map is arranged in layers along the way it runs: the rows of a map that runs from top to
 * bottom, the columns of one that runs from left to right.
 *
 * The layout engine of the map library (ELK) breaks the cycles of a map without knowing how many
 * incidents a path carries. Where paths lead back into the activity the incidents begin with, it
 * may turn the main way around. The library keeps Start in the first layer and End in the last by
 * itself, but leaves the activity the incidents begin with to the paths, and that activity then
 * stands late in the map, far from Start. The engine takes the layer of a node as a constraint, but
 * the library has no setting for one. What it has is `layout.elk`, an engine it is given. The
 * engine given here writes the constraints into the graph the library hands over and passes it on
 * to a real ELK, in the worker the application serves.
 *
 * What the library does with a given engine, and what follows from it here:
 * - It hands over one graph: the root, every stage that has an activity as a node with children,
 *   every other node by its id, the sizes it resolved, and the options on the root, among them the
 *   `elkOptions` of the layout. It calls `layout(graph)` and nothing else.
 * - It neither stops nor ends a given engine. When the time of a layout is over it stops waiting
 *   and arranges by its fallback, and it stops waiting for a layout a newer one replaced. So a run
 *   is ended here: its worker is stopped with what it still computes.
 * - It keys a layout by the nodes, the paths, the stages and the options, a given engine left out.
 *   The first activity depends on the incidents of the flows, which are no part of that key, so it
 *   travels as an option: a map with another first activity is arranged anew.
 */

/** A map runs from top to bottom. */
export const TOP_TO_BOTTOM = "DOWN";
/** A map runs from left to right. */
export const LEFT_TO_RIGHT = "RIGHT";
/** The two ways a map runs, as the map library names them. */
export type MapDirection = typeof TOP_TO_BOTTOM | typeof LEFT_TO_RIGHT;

/**
 * The way a map runs when it opens. Its cards are wide and low, so from top to bottom a map is
 * bound by its height and its widest row, and is drawn larger in a frame that is wider than high.
 */
export const OPENING_DIRECTION: MapDirection = TOP_TO_BOTTOM;

/** The room between two neighbours of a layer and between two layers. */
const SPACING = { node: 24, layer: 48 };

/** Paths run in right angles: the map library draws a route as straight pieces from bend to bend. */
const ROUTES = "ORTHOGONAL";

/** The option by which ELK takes the layer of a node. */
const LAYER = "elk.layered.layering.layerConstraint";

/**
 * The option on the root of the graph that names the first activity. It is not one of ELK's: the
 * map library carries every `elkOptions` entry to the root, where it is read and taken out here.
 */
export const FIRST_ACTIVITY = "wise.firstActivity";

/** The milliseconds an arrangement may take, for the map library and for the engine it is given alike. */
export const ARRANGED_WITHIN_MS = 20_000;

/** The incidents on a flow, the number the map writes on it. */
const incidentsOn = (flow: FlowEdge) => flow.metrics?.cases ?? flow.metrics?.count ?? 0;

/**
 * The activity that stands first on a map: the target of Start's strongest flow, the first of
 * equals in the order of the graph. With stages shown as nodes it is the stage that flow leads to.
 * Undefined for a map without Start, or without a flow from Start to a node it shows.
 */
export function firstActivity(graph: FlowGraph): string | undefined {
  const shown = new Set(graph.nodes.map((node) => node.id));
  let strongest: FlowEdge | undefined;
  for (const edge of graph.edges) {
    if (edge.source !== START_ID || edge.target === END_ID || !shown.has(edge.target)) continue;
    if (strongest === undefined || incidentsOn(edge) > incidentsOn(strongest)) strongest = edge;
  }
  return strongest?.target;
}

/**
 * The graph the map library hands to the engine, with the layers of Start, End and the first
 * activity written into it: Start alone in the first layer, End alone in the last, the first
 * activity in the layer after Start. An activity inside a stage is the first of its stage; where
 * the stage stands is left to the order of the stages. Paths into the first activity are then
 * drawn as returns. A node that is not on the map takes no layer, and the graph given is not changed.
 */
export function pinned(graph: ElkNode): ElkNode {
  const { [FIRST_ACTIVITY]: first, ...options } = graph.layoutOptions ?? {};
  const layers = new Map([
    [START_ID, "FIRST_SEPARATE"],
    [END_ID, "LAST_SEPARATE"],
  ]);
  if (first !== undefined && !layers.has(first)) layers.set(first, "FIRST");
  const inLayer = (node: ElkNode): ElkNode => {
    // A stage is a node with children and takes no layer itself, also where it shares its id with a node.
    if (node.children) return { ...node, children: node.children.map(inLayer) };
    const layer = layers.get(node.id);
    return layer === undefined ? node : { ...node, layoutOptions: { ...node.layoutOptions, [LAYER]: layer } };
  };
  return { ...graph, layoutOptions: options, children: graph.children?.map(inLayer) };
}

/** What is used of a real ELK: it arranges a graph, and it is stopped with whatever it still computes. */
export interface Engine {
  layout(graph: ElkNode): Promise<ElkNode>;
  stop(): void;
}

export interface EngineUse {
  /**
   * Whether an arrangement ends the one that is still running. So it is for one map: the library
   * has stopped waiting for the earlier one. Without it every arrangement asked for is computed,
   * each in an engine of its own while another runs.
   */
  replacing?: boolean;
  timeoutMs?: number;
}

/**
 * The engine the map library is given: every graph is arranged by a real ELK with the layers of
 * `pinned`. One engine is kept between two arrangements, so that the next one starts no worker.
 *
 * A run that is ended, because its time is over or another replaces it, has its engine stopped and
 * is never answered. The library has stopped waiting for it by then, at its own timeout of the same
 * length or for the newer layout; an error in its place would have the library arrange a map in
 * stages once more, without the order of its stages. An error of the engine itself is passed on,
 * and the library then arranges by its fallback.
 */
export function pinningElk(start: () => Promise<Engine>, { replacing = false, timeoutMs = ARRANGED_WITHIN_MS }: EngineUse = {}): ELK {
  let idle: Promise<Engine> | undefined;
  let endRunning: (() => void) | undefined;

  function layout(graph: ElkNode): Promise<ElkNode> {
    if (replacing) endRunning?.();
    const engine = idle ?? start();
    idle = undefined;
    return new Promise<ElkNode>((resolve, reject) => {
      let running = true;
      const over = (keep: boolean) => {
        running = false;
        clearTimeout(timer);
        if (endRunning === end) endRunning = undefined;
        if (keep && idle === undefined) idle = engine;
        else engine.then((elk) => elk.stop(), () => undefined);
      };
      const end = () => {
        if (running) over(false);
      };
      const timer = setTimeout(end, timeoutMs);
      if (replacing) endRunning = end;
      const failed = (error: unknown) => {
        if (!running) return;
        over(false);
        reject(error);
      };
      engine.then((elk) => {
        if (!running) return;
        elk.layout(pinned(graph)).then((arranged) => {
          if (!running) return;
          over(true);
          resolve(arranged);
        }, failed);
      }, failed);
    });
  }

  // The map library calls nothing but `layout` on an engine it is given.
  return { layout } as ELK;
}

type ElkClass = new (use?: { workerUrl?: string }) => ELK;

/** The class of a module of elkjs: its CommonJS export, which a bundler may hand over wrapped once more. */
function elkClass(module: { default: ElkClass }): ElkClass {
  const exported = module.default as ElkClass & { default?: ElkClass };
  return exported.default ?? exported;
}

/** The one ELK of a page without workers; it holds the page while it arranges and cannot be stopped. */
let inPage: Promise<Engine> | undefined;

/**
 * A real ELK in a worker of its own, started from the worker file the application serves. Where
 * there are no workers (the tests), the ELK that runs in the page itself, one for all.
 */
function served(): Promise<Engine> {
  if (typeof Worker === "undefined") {
    return (inPage ??= import("elkjs/lib/elk.bundled.js").then((module) => {
      const elk = new (elkClass(module))();
      return { layout: (graph) => elk.layout(graph), stop: () => undefined };
    }));
  }
  return import("elkjs/lib/elk-api.js").then((module) => {
    const elk = new (elkClass(module))({ workerUrl: elkWorkerUrl });
    return { layout: (graph) => elk.layout(graph), stop: () => elk.terminateWorker() };
  });
}

/** Arranges the one map on the page: each arrangement it asks for replaces the one before it. */
const ofMap = pinningElk(served, { replacing: true });
/** Arranges the map of a whole parent. The map view keeps every one it asked for, so none is ended for another. */
const ofParent = pinningElk(served);

/**
 * The layout of a graph of the map that runs this way: arranged by the given engine with Start,
 * End and the first activity of this graph in their layers, within the time both the library and
 * the engine keep. When ELK fails or takes too long the library arranges by its fallback, in the
 * worker the application serves for it. That engine runs the same way but takes no layers and
 * routes no right angles: the map is arranged all the same, and Start and End stand where it puts them.
 */
function arrangedBy(elk: ELK, graph: FlowGraph, direction: MapDirection): LayoutOptions {
  const first = firstActivity(graph);
  return {
    elk,
    dagreWorkerUrl,
    timeoutMs: ARRANGED_WITHIN_MS,
    direction,
    spacing: SPACING,
    edgeRouting: ROUTES,
    ...(first !== undefined && { elkOptions: { [FIRST_ACTIVITY]: first } }),
  };
}

/** The layout of the map on the page, for the graph it draws at its detail and the way it runs. */
export const mapArrangement = (drawn: FlowGraph, direction: MapDirection): LayoutOptions => arrangedBy(ofMap, drawn, direction);

/** The layout of the map of a whole parent, from which every map of a selection reads the places of its activities. */
export const parentArrangement = (parent: FlowGraph, direction: MapDirection): LayoutOptions => arrangedBy(ofParent, parent, direction);
