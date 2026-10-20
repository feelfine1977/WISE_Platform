import webPackage from "../../package.json";
import { InfoPopover } from "../components/InfoPopover";

/**
 * The keys of every action of the investigation, as this build carries them out. Each row is what the part named does
 * with the keyboard here; nothing is fetched, so the guide is the one of the build that shows it.
 */
export const KEYS: readonly (readonly [string, string])[] = [
  ["Views", "Tab to Map, Incidents, Variants, Paths or Matrix; Enter or Space shows it."],
  ["Steps", "Tab enters Undo, Redo and Clear all; the arrow keys, Home and End move between them; Escape goes back to the view shown."],
  ["Trail of steps", "Tab enters it; the arrow keys, Home and End move between the steps; Enter opens a step, its counts and its actions."],
  ["+ Add step", "Enter opens the kinds of step; Escape closes them and goes back to the button."],
  ["Map", "The arrow keys move between activities, Alt with an arrow along the paths; Space selects; Enter opens the actions of an element; Escape clears."],
  ["Charts of starts and numbers", "The arrow keys, Home and End move; Shift with an arrow widens the range; Enter takes the step; Escape clears."],
  ["Table of incidents", "Tab enters it; the arrow keys, Page Up, Page Down, Home and End move; Enter opens every record of the incident."],
  ["History of an incident", "Escape closes it and gives the keyboard back to where it was opened."],
  ["Panels like this one", "Escape closes the panel and gives the keyboard back to its button."],
];

/**
 * The keyboard guide of the investigation behind one info button: every action has its keys, and the guide names the
 * build it belongs to, the web version and the version of the local service that answers it.
 */
export function KeysGuide({ serviceVersion }: { serviceVersion: string }) {
  return (
    <InfoPopover label="Keys">
      <p className="about-lead">Every action of the investigation with its keys.</p>
      <dl className="pairs keys-guide">
        {KEYS.map(([part, keys]) => (
          <div key={part}>
            <dt>{part}</dt>
            <dd>{keys}</dd>
          </div>
        ))}
      </dl>
      <p className="muted keys-version">
        This guide is part of this build: web {webPackage.version}, local service {serviceVersion}. It is shown from this computer, without a network.
      </p>
    </InfoPopover>
  );
}
