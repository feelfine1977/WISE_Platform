import { useEffect, useRef } from "react";
import { type Box, type FitView, fitViewport, panelInsets, spaceTokens } from "wise-flow";
// The map library's own access to the map it draws, which it offers to a control placed inside its map.
import { useReactFlow, useStore } from "wise-flow/react";

/**
 * How the map library fits a map drawn as elements, as its documentation says it: 4 % of the size
 * of what is fitted on each side, between the zoom 0.05 and 3, and clear of the panels over the map
 * with a gap of 8 px.
 */
const FIT = { padding: 0.04, minZoom: 0.05, maxZoom: 3 };
const PANEL_GAP = spaceTokens.unit * 4;
const PANELS = ".wf-overlay-panel, .react-flow__panel";
/** The element of the map whose size the map takes as its own. */
const PANE = ".react-flow__renderer";

/** How far two views may lie apart and still be the same view: half a pixel, and a thousandth of the zoom. */
const SAME_PLACE = 0.5;
const SAME_ZOOM = 0.001;

interface Size {
  width: number;
  height: number;
}

/**
 * The view the map library's fit gives: `bounds` whole in the `area` the map is drawn in, clear of
 * the `panels` over it, whose boxes are in the pixels of the `frame` the area fills. Computed with
 * the library's own two functions of the fit, in the way its map calls them.
 */
export function fittedView(bounds: Box, area: Size, frame: Size, panels: readonly Box[]): FitView {
  const insets = panelInsets(panels, frame, bounds, { ...FIT, gap: PANEL_GAP });
  return fitViewport(bounds, area, { ...FIT, insets });
}

/** Whether two views show the same: neither the place nor the zoom differs by more than rounding. */
export function sameView(one: FitView, other: FitView): boolean {
  return Math.abs(one.x - other.x) <= SAME_PLACE && Math.abs(one.y - other.y) <= SAME_PLACE && Math.abs(one.zoom - other.zoom) <= SAME_ZOOM;
}

/** The frame and the view at one look at them. */
export interface Look extends Size {
  view: FitView;
  /** The fitted view for this frame and what is drawn in it; none while nothing is drawn. */
  fitted: FitView | undefined;
}

/** What is kept from one look at the frame and the view to the next. */
export interface Seen extends Size {
  /** Whether the view was the fitted one. */
  wasFitted: boolean;
  /** The fitted view for this frame, as it was at this look. */
  fitted: FitView | undefined;
  /**
   * The fitted view for the frame before its size changed, kept while the view was not the fitted
   * one at that change: a fit that was still on its way then ends there.
   */
  earlier?: FitView;
}

/**
 * What to keep of a look at the frame and the view, and the view to move to, if any. A look is
 * taken whenever the frame's size or the view changes.
 *
 * Whether the view is the fitted one is read from the view itself each time it moves: the move
 * ended on the fitted view (the library's fit after an arrangement, its "Fit the map" button, a fit
 * made here), or somewhere else (a pan, a zoom, a view the map is asked to keep). When the frame
 * changes its size, a view that was the fitted one is fitted to the new frame, and any other view
 * stays where it is. A fit of the library that was still moving the view when the frame changed is
 * known by where it ends, the fitted view for the frame before; the view is then fitted to the frame
 * it ended in.
 */
export function follow(before: Seen | null, now: Look): { seen: Seen; moveTo?: FitView } {
  const frame = { width: now.width, height: now.height, fitted: now.fitted };
  if (before !== null && (before.width !== now.width || before.height !== now.height)) {
    if (before.wasFitted) return { seen: { ...frame, wasFitted: true }, moveTo: now.fitted };
    return { seen: { ...frame, wasFitted: false, earlier: before.earlier ?? before.fitted } };
  }
  if (before?.earlier && now.fitted && sameView(before.earlier, now.view)) return { seen: { ...frame, wasFitted: true }, moveTo: now.fitted };
  const wasFitted = now.fitted !== undefined && sameView(now.fitted, now.view);
  return { seen: { ...frame, wasFitted, ...(!wasFitted && before?.earlier ? { earlier: before.earlier } : {}) } };
}

/**
 * Fits the map again when its frame changes its size: a side panel opens, the panel of a selected
 * element appears, the window is resized. Nothing is arranged again; only the view moves, at once,
 * so that it follows the frame. A view the analyst chose is kept (`follow`).
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
  const seen = useRef<Seen | null>(null);

  useEffect(() => {
    // The map takes the size of its frame a moment after the page has laid the frame out anew. In
    // between, what is measured on the page and the size the map holds do not belong together: the
    // look waits until the map has taken the size, which brings the next one.
    const measured = frame?.querySelector<HTMLElement>(PANE) ?? frame;
    if (measured && (measured.offsetWidth !== width || measured.offsetHeight !== height)) return;
    /** The fitted view for the frame as it is now. */
    const fitted = (): FitView | undefined => {
      const bounds = map.getNodesBounds(map.getNodes());
      if (!frame || !(bounds.width > 0) || !(bounds.height > 0) || !(width > 0) || !(height > 0)) return undefined;
      const origin = frame.getBoundingClientRect();
      const panels = Array.from(frame.querySelectorAll(PANELS), (panel) => {
        const box = panel.getBoundingClientRect();
        return { x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height };
      });
      return fittedView(bounds, { width, height }, origin, panels);
    };
    const [x, y, zoom] = view;
    const next = follow(seen.current, { width, height, view: { x, y, zoom }, fitted: fitted() });
    seen.current = next.seen;
    if (next.moveTo) void map.setViewport(next.moveTo);
  }, [map, frame, width, height, view]);

  return null;
}

/** The control as the map is given it: one element for every map, so that the map is given the same each time it is drawn. */
export const fitToFrame = <FitToFrame />;
