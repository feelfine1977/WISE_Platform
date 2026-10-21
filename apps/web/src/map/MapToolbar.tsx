import type { ReactNode, Ref } from "react";
import { IconButton } from "../components/icons";
import { InfoPopover } from "../components/InfoPopover";
import { LEFT_TO_RIGHT, type MapDirection, TOP_TO_BOTTOM } from "./arrange";
import "./toolbar.css";

/** What the switch of the direction does, said in its tooltip. */
export const DIRECTION_HINT = "Off, the map runs top to bottom, from Start above to End below. On, it runs left to right, from Start at the left to End at the right.";

/** What going back to the opening does, said in its tooltip. */
export const OPENING_HINT = "Shows the map again as it opened: readable, near Start, with the overview of the whole map where the whole does not fit.";

interface MapToolbarProps {
  /** Whether the map is drawn below. The list of every path is no picture: nothing is arranged or overviewed there. */
  picture: boolean;
  /** Shows the map again as it opened. */
  onOpening: () => void;
  /** Which way the map runs: top to bottom at first, left to right on request. */
  direction: MapDirection;
  onDirection: (direction: MapDirection) => void;
  /** Whether the map shows a small picture of the whole of it in its corner. */
  overview: boolean;
  onOverview: (overview: boolean) => void;
  /** Whether the editor of the stages stands beside the map. */
  editingStages: boolean;
  onEditStages: (editing: boolean) => void;
  /** The switch of the editor, so that the keyboard can be given back to it when the editor is closed there. */
  stagesSwitch?: Ref<HTMLButtonElement>;
  /** That the map leaves out something the detail controls do not count, in words; "About this map" carries a mark while it is given. */
  notDrawn?: string;
  /** What "About this map" says. */
  children: ReactNode;
}

/**
 * The tools of the map as one row of icon buttons at the right end of its detail controls: how the
 * picture is arranged and whether it shows its overview, then the editor of the stages and what
 * there is to know about the map. Nothing of it takes room from the map.
 */
export function MapToolbar({ picture, onOpening, direction, onDirection, overview, onOverview, editingStages, onEditStages, stagesSwitch, notDrawn, children }: MapToolbarProps) {
  return (
    <div className="icon-toolbar map-toolbar" role="group" aria-label="Map tools">
      {picture && (
        <>
          <IconButton icon="opening" label="Back to the opening" hint={OPENING_HINT} onClick={onOpening} />
          <IconButton
            icon="orientation"
            label="Run the map left to right"
            hint={DIRECTION_HINT}
            pressed={direction === LEFT_TO_RIGHT}
            onClick={() => onDirection(direction === LEFT_TO_RIGHT ? TOP_TO_BOTTOM : LEFT_TO_RIGHT)}
          />
          <IconButton icon="overview" label="Overview of the whole map" pressed={overview} onClick={() => onOverview(!overview)} />
          <span className="icon-toolbar-separator" aria-hidden="true" />
        </>
      )}
      <IconButton icon="editStages" label="Edit stages" pressed={editingStages} ref={stagesSwitch} onClick={() => onEditStages(!editingStages)} />
      <InfoPopover label="About this map" mark={notDrawn}>
        {children}
      </InfoPopover>
    </div>
  );
}
