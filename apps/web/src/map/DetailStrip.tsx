import type { ReactNode } from "react";
import type { AbstractOptions, PartInView } from "wise-flow";
import { AbstractionControls } from "wise-flow/react";
import "./canvas.css";
import { type MapDetail, statementAsText } from "./detail";

interface DetailStripProps {
  /** The detail the map is given. */
  detail: AbstractOptions;
  /** What the map draws at that detail. */
  shown: MapDetail;
  onChange: (detail: AbstractOptions) => void;
  /** Whether the map is shown as the map library's table; without `onViewChange` the strip offers no switch. */
  view?: "map" | "table";
  onViewChange?: (view: "map" | "table") => void;
  /** What stands in the row before the controls: the switch of what the map's numbers count. */
  lead?: ReactNode;
  /** What else stands in the row of the strip, after the controls: the tools of the map. */
  children?: ReactNode;
  /** Where the Canvas map draws fewer of the selected paths at its zoom: both numbers, which the controls say. */
  drawn?: { selected: number; drawn: number };
  /** What the map's view shows of it, as the map library reports it when the view rests; the controls say it while part of the map is out of view. */
  inView?: PartInView;
}

/**
 * The detail controls of the map in a strip above its canvas, so that the canvas is the map's
 * alone: the map library's own two sliders, each with the statement of what is shown, and its
 * switch to the table view. The sliders stand where the map's detail stands and the statements are
 * those of the graph the map draws (`mapDetail`); where the library's Canvas draws fewer of the
 * selected paths at its zoom, the strip says how many; while part of a large map is out of view, how
 * many activities and paths are in it ("17 of 42 activities and 23 of 60 paths in view"). When moving
 * one slider changes the statement of the other, the controls say it in a live region of their own.
 * The tools of the map stand in the same row, after the controls.
 */
export function DetailStrip({ detail, shown, onChange, view, onViewChange, lead, children, drawn, inView }: DetailStripProps) {
  return (
    <div className="map-detail">
      {lead}
      <AbstractionControls
        value={detail}
        onChange={onChange}
        locale="en"
        hasStages={shown.hasStages}
        view={view}
        onViewChange={onViewChange}
        positions={shown.positions}
        statement={statementAsText(shown.statement)}
        drawn={drawn}
        inView={inView}
      />
      {children}
    </div>
  );
}
