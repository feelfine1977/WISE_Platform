import type { ReactNode, Ref } from "react";
import { IconButton } from "../components/icons";
import { InfoPopover } from "../components/InfoPopover";
import "./toolbar.css";

/** What keeping the activities in place does, and what it costs: the explanation of the switch, said in its tooltip. */
export const IN_PLACE_HINT =
  "Keep every activity in the place the map of all incidents gives it. " +
  "Off, the map is arranged anew and compactly for what is shown. " +
  "On, places stay the same from one selection to the next, and hidden paths still shape the picture.";

interface MapToolbarProps {
  /** Whether the map is drawn below. The list of every path is no picture: nothing is arranged or overviewed there. */
  picture: boolean;
  /** Whether every activity keeps the place the whole parent's map gives it. */
  inPlace: boolean;
  onInPlace: (inPlace: boolean) => void;
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
export function MapToolbar({ picture, inPlace, onInPlace, overview, onOverview, editingStages, onEditStages, stagesSwitch, notDrawn, children }: MapToolbarProps) {
  return (
    <div className="icon-toolbar map-toolbar" role="group" aria-label="Map tools">
      {picture && (
        <>
          <IconButton icon="pin" label="Keep activities in place" hint={IN_PLACE_HINT} pressed={inPlace} onClick={() => onInPlace(!inPlace)} />
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
