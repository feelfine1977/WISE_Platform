import { abstract, type AbstractOptions, type DetailPositions, type DetailStatement, detailStatement, type FlowGraph, type Locale } from "wise-flow";

/** The detail that leaves nothing out, as the map library is given it while the analyst has set none. */
export const WHOLE_DETAIL: AbstractOptions = {};

/**
 * The number of activities and paths together above which the map library draws on its Canvas
 * instead of as elements of the page. It is the library's own default, and the map is given it by
 * name, so that the map and what is said beside it switch at the same number.
 */
export const CANVAS_FROM = 2000;

/** What the map draws at a detail, and what its detail controls say about it. */
export interface MapDetail {
  /** The graph the map draws: the map library's reduction of the graph it is given. */
  drawn: FlowGraph;
  /** Where the two sliders can stand and where they stand; absent only for a graph the library did not reduce. */
  positions: DetailPositions | undefined;
  /** The statements beside the sliders. */
  statement: DetailStatement | undefined;
  /** Whether the controls offer to show stages in place of their activities. */
  hasStages: boolean;
  /**
   * Whether the map library draws this graph on its Canvas. There it decides by the zoom and by
   * the time a frame takes how many of the selected paths it draws, and says so in its own detail
   * panel; that number cannot be read from outside the map. Drawn as elements, the map is told to
   * draw every path its detail selects.
   */
  onCanvas: boolean;
}

/**
 * What the map library draws of a graph at a detail, and the positions and statements of its detail
 * controls, computed here as the library computes them inside its map: with its own `abstract` and
 * `detailStatement`, from the same graph and the same detail, in the same two steps (the stages
 * collapsed first, then the reduction by the shares). Nothing is counted here.
 *
 * It holds as long as the map is given exactly this graph and this detail, controlled, and no
 * marks beside the graph (`overlays`): marks would have to join the graph here as they do there.
 * The selection, a focus on the paths of an activity and the table view change none of it.
 */
export function mapDetail(graph: FlowGraph, detail: AbstractOptions, locale: Locale = "en"): MapDetail {
  const base = detail.collapse ? abstract(graph, { collapse: detail.collapse, keepConnected: false }) : graph;
  const drawn = abstract(base, { ...detail, collapse: false });
  // The labels of elements not drawn are those of the graph before the reduction.
  const labels = new Map(base.nodes.map((node) => [node.id, node.label]));
  return {
    drawn,
    positions: drawn.meta?.shown?.positions,
    statement: detailStatement(drawn, { locale, marks: base.overlays, labelOf: (id) => labels.get(id) ?? id }),
    hasStages: (base.groups ?? []).some((group) => group.kind === "stage") || !!detail.collapse,
    onCanvas: drawn.nodes.length + drawn.edges.length > CANVAS_FROM,
  };
}

/**
 * The statements as they are shown outside the map. Inside it, the part that counts the kept paths
 * is a button that marks those paths on the map; only the map can mark them, so outside it the
 * same words are plain text and not a button that does nothing.
 */
export function statementAsText(statement: DetailStatement | undefined): DetailStatement | undefined {
  if (statement === undefined) return undefined;
  const { keptPart: _marksOnTheMap, ...paths } = statement.paths;
  return { ...statement, paths };
}
