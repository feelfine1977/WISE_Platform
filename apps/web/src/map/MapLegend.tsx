import { useMemo, useRef } from "react";
import { buildScene, createPositions, type FlowGraph, type Measure, measureStyle, type StyleSpec, type ThemeOverrides } from "wise-flow";
import { Legend, useFlowTheme } from "wise-flow/react";

/**
 * A box for every activity and group, in a row: the library lists in its legend only the scales of what it draws, so the
 * scene of the legend draws every element of the graph somewhere. Where does not matter to the legend.
 */
function placeholders(graph: FlowGraph) {
  const box = (index: number) => ({ x: index * 200, y: 0, width: 160, height: 60 });
  return createPositions(
    {
      nodes: Object.fromEntries(graph.nodes.map((node, index) => [node.id, box(index)])),
      groups: Object.fromEntries((graph.groups ?? []).map((group, index) => [group.id, box(index)])),
      edges: {},
    },
    "given",
    "RIGHT",
  );
}

interface MapLegendProps {
  /** The graph the map draws at its detail (`mapDetail(...).drawn`). */
  graph: FlowGraph;
  measure: Measure;
  /** The style laid over the measure's, as the map is given it. */
  over: StyleSpec;
  /** The theme the map is given, read over the same CSS variables the map reads. */
  theme: ThemeOverrides;
  onMeasure: (measure: Measure) => void;
}

/**
 * The legend of the map under its canvas rather than over it: the map library's own legend, from
 * the scene the library builds for the same graph, style, theme and locale, so that it names the
 * scales and colours the map draws. Its one-line strip names the measure; shown whole, it lists the
 * classes and the stages and offers the three measures to switch between.
 */
export function MapLegend({ graph, measure, over, theme, onMeasure }: MapLegendProps) {
  const host = useRef<HTMLDivElement>(null);
  const look = useFlowTheme(host, theme);
  const scene = useMemo(
    () => buildScene(graph, placeholders(graph), { style: measureStyle(measure, over), locale: "en", theme: look.theme, scheme: look.scheme, lodBySize: true }),
    [graph, measure, over, look],
  );
  return (
    <div className="map-legend" ref={host}>
      <Legend scales={scene.scales} legend={scene.legend} locale="en" measure={measure} onMeasureChange={onMeasure} />
    </div>
  );
}
