import { useEffect, useRef } from "react";
import { type Box, type FitView, type FlowNode, type LayoutDirection, openingView, processStart, spaceTokens, viewTokens } from "wise-flow";
// The map library's own access to the map it draws, which it offers to a control placed inside its map.
import { useReactFlow, useStore } from "wise-flow/react";

/**
 * How the map library fits a map drawn as elements, as its documentation says it: 4 % of the size
 * of what is fitted on each side, between the smallest and the largest zoom the map holds (0.05 and
 * 3 unless the map is given others), and clear of the panels over the map with a gap of 8 px. Its
 * overview is no panel the fit keeps clear of: the library places it after the fit.
 */
const FIT = { padding: 0.04, minZoom: 0.05, maxZoom: 3 };
const PANEL_GAP = spaceTokens.unit * 4;
const PANELS = ".wf-overlay-panel:not(.wf-overview), .react-flow__panel";
/** The element of the map whose size the map takes as its own. */
const PANE = ".react-flow__renderer";

/** How far two views may lie apart and still be the same view: half a pixel, and a thousandth of the zoom. */
const SAME_PLACE = 0.5;
const SAME_ZOOM = 0.001;

interface Size {
  width: number;
  height: number;
}

/** Where the map opens on where the whole does not fit readably: the box of Start, the way the map runs and the cards no panel may cover. */
export interface Start {
  box: Box;
  direction: LayoutDirection;
  boxes: readonly Box[];
}

/**
 * The view the map library's fit gives: `bounds` whole in the `area` the map is drawn in, clear of
 * the `panels` over it, whose boxes are in the area's pixels, within the `zoom` range the map holds.
 * Where the whole map does not fit at the smallest zoom and `start` is given, the map from Start at
 * that zoom, as the library's own fit shows it. Computed with the library's own function of the
 * opening view, in the way its map calls it.
 */
export function fittedView(bounds: Box, area: Size, panels: readonly Box[], zoom: { minZoom: number; maxZoom: number } = FIT, start?: Start): FitView {
  return libraryView(bounds, area, panels, zoom, zoom.minZoom, start);
}

/**
 * The view the map library opens a map at, as it computes it: the fitted view where the whole map
 * fits at the opening zoom (0.75) or the smallest zoom, whichever is larger, and otherwise the map
 * from Start at that zoom, with room for the overview. Without `start` it is the fitted view.
 */
export function openedView(bounds: Box, area: Size, panels: readonly Box[], zoom: { minZoom: number; maxZoom: number } = FIT, start?: Start): FitView {
  return libraryView(bounds, area, panels, zoom, Math.max(viewTokens.openingZoom, zoom.minZoom), start);
}

/** The library's view with `readable` as the zoom the map is shown at from Start where the whole does not fit at it, with room for the overview, which has the map's shape at the library's size. */
function libraryView(bounds: Box, area: Size, panels: readonly Box[], zoom: { minZoom: number; maxZoom: number }, readable: number, start?: Start): FitView {
  const scale = Math.min(viewTokens.overview.width / Math.max(bounds.width, 1), viewTokens.overview.height / Math.max(bounds.height, 1));
  const overview = { width: Math.max(1, Math.round(bounds.width * scale)), height: Math.max(1, Math.round(bounds.height * scale)) };
  const { x, y, zoom: shown } = openingView(bounds, area, { padding: FIT.padding, ...zoom, panels, gap: PANEL_GAP, readable, start: start?.box, direction: start?.direction, boxes: start?.boxes, overview });
  return { x, y, zoom: shown };
}

/** Whether two views show the same: neither the place nor the zoom differs by more than rounding. */
export function sameView(one: FitView, other: FitView): boolean {
  return Math.abs(one.x - other.x) <= SAME_PLACE && Math.abs(one.y - other.y) <= SAME_PLACE && Math.abs(one.zoom - other.zoom) <= SAME_ZOOM;
}

/** The frame and the view at one look at them. */
export interface Look extends Size {
  view: FitView;
  /** The views the library's own moves give for this frame and what is drawn in it: its fit and its opening; none while nothing is drawn. */
  fitted: readonly FitView[];
}

/** What is kept from one look at the frame and the view to the next. */
export interface Seen extends Size {
  /** Which of the library's views the view was: its place in `fitted`; none for a view the analyst chose. */
  fittedAs: number | undefined;
  /** The library's views for this frame, as they were at this look. */
  fitted: readonly FitView[];
  /**
   * The library's views for the frame before its size changed, kept while the view was none of them
   * at that change: a move of the library that was still on its way then ends on one of them.
   */
  earlier?: readonly FitView[];
}

/**
 * What to keep of a look at the frame and the view, and the view to move to, if any. A look is
 * taken whenever the frame's size or the view changes.
 *
 * Whether the view is one the library made is read from the view itself each time it moves: the
 * move ended on the library's fit or its opening (after an arrangement, its "Fit the map" button, a
 * move made here), or somewhere else (a pan, a zoom, a view the map is asked to keep). When the
 * frame changes its size, a view that was the library's fit is fitted to the new frame, one that
 * was its opening is opened in the new frame, and any other view stays where it is. A move of the
 * library that was still under way when the frame changed is known by where it ends, one of the
 * library's views for the frame before; the view is then moved to the same view for the frame it
 * ended in.
 */
export function follow(before: Seen | null, now: Look): { seen: Seen; moveTo?: FitView } {
  const frame = { width: now.width, height: now.height, fitted: now.fitted };
  if (before !== null && (before.width !== now.width || before.height !== now.height)) {
    if (before.fittedAs !== undefined) return { seen: { ...frame, fittedAs: before.fittedAs }, moveTo: now.fitted[before.fittedAs] };
    return { seen: { ...frame, fittedAs: undefined, earlier: before.earlier ?? before.fitted } };
  }
  const endedAs = before?.earlier?.findIndex((view) => sameView(view, now.view)) ?? -1;
  if (endedAs >= 0 && now.fitted[endedAs]) return { seen: { ...frame, fittedAs: endedAs }, moveTo: now.fitted[endedAs] };
  const fittedAs = now.fitted.findIndex((view) => sameView(view, now.view));
  return { seen: { ...frame, fittedAs: fittedAs >= 0 ? fittedAs : undefined, ...(fittedAs < 0 && before?.earlier ? { earlier: before.earlier } : {}) } };
}

/**
 * Fits or opens the map again when its frame changes its size: a side panel opens, the panel of a
 * selected element appears, the window is resized. Nothing is arranged again; only the view moves,
 * at once, so that it follows the frame: a fitted map is fitted to the new frame, an opened one
 * opened in it. A view the analyst chose is kept (`follow`).
 *
 * Placed inside the map, it reads the map's size and view and sets the view through what the map
 * library hands a control of its own. It does nothing on the library's Canvas and in its table
 * view, which are not drawn as elements.
 */
export function FitToFrame(): null {
  const map = useReactFlow();
  const frame = useStore((state) => state.domNode);
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const view = useStore((state) => state.transform);
  // The zoom range the map holds: its smallest zoom is the readable one it derives from its cards.
  const minZoom = useStore((state) => state.minZoom);
  const maxZoom = useStore((state) => state.maxZoom);
  const seen = useRef<Seen | null>(null);

  useEffect(() => {
    // The map takes the size of its frame a moment after the page has laid the frame out anew. In
    // between, what is measured on the page and the size the map holds do not belong together: the
    // look waits until the map has taken the size, which brings the next one.
    const measured = frame?.querySelector<HTMLElement>(PANE) ?? frame;
    if (measured && (measured.offsetWidth !== width || measured.offsetHeight !== height)) return;
    /** The library's views for the frame as it is now: its fit and its opening. */
    const fitted = (): FitView[] => {
      const nodes = map.getNodes();
      const bounds = map.getNodesBounds(nodes);
      if (!frame || !(bounds.width > 0) || !(bounds.height > 0) || !(width > 0) || !(height > 0)) return [];
      const origin = frame.getBoundingClientRect();
      const panels = Array.from(frame.querySelectorAll(PANELS), (panel) => {
        const box = panel.getBoundingClientRect();
        return { x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height };
      });
      // Where the map opens on when the whole does not fit readably: Start, the way the map runs and the cards, as the library reads them from its nodes.
      const placed: Record<string, Box> = {};
      const drawn: FlowNode[] = [];
      let direction: LayoutDirection | undefined;
      for (const node of nodes) {
        const data = node.data as { node?: FlowNode; direction?: LayoutDirection };
        const at = map.getInternalNode(node.id)?.internals.positionAbsolute ?? node.position;
        placed[node.id] = { x: at.x, y: at.y, width: node.measured?.width ?? node.width ?? 0, height: node.measured?.height ?? node.height ?? 0 };
        if (data.node) drawn.push(data.node);
        direction ??= data.direction;
      }
      const startBox = processStart(drawn, { nodes: placed, direction: direction ?? "RIGHT" });
      const start = startBox && { box: startBox, direction: direction ?? "RIGHT", boxes: drawn.filter((node) => node.kind === "activity").flatMap((node) => placed[node.id] ?? []) };
      const area = { width, height };
      return [fittedView(bounds, area, panels, { minZoom, maxZoom }, start), openedView(bounds, area, panels, { minZoom, maxZoom }, start)];
    };
    const [x, y, zoom] = view;
    const next = follow(seen.current, { width, height, view: { x, y, zoom }, fitted: fitted() });
    seen.current = next.seen;
    if (next.moveTo) void map.setViewport(next.moveTo);
  }, [map, frame, width, height, view, minZoom, maxZoom]);

  return null;
}

/** The control as the map is given it: one element for every map, so that the map is given the same each time it is drawn. */
export const fitToFrame = <FitToFrame />;
