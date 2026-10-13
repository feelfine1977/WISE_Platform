import { type FormEvent, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { countOf } from "../data/wording";
import type { SuppliedGraph } from "../generated/selection";
import { moved, nameProblem, renamed, type Stage, type StageDefinitions, stageName, withActivity, withoutStage, withStage } from "./definitions";
import { browserStages, type StagedReading, type StageStore, useStages } from "./store";
import "./stages.css";

interface StagesEditorProps {
  /** The reading the stages are defined for. */
  reading: StagedReading;
  /** The map of every incident of the parent: a stage is chosen for each of its activities. */
  parentGraph: SuppliedGraph;
  /** Where the stages are held; the browser's own unless the caller holds them elsewhere. */
  store?: StageStore;
}

/** An activity of the parent's map, with the supplied number of incidents that contain it. */
interface ListedActivity {
  name: string;
  incidents: number;
}

const activities = (count: number) => countOf(count, "activity", "activities");
const integer = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** Why a name was not given, in words. */
function refusal(problem: "empty" | "taken", name: string): string {
  return problem === "empty" ? "A stage needs a name." : `Another stage is already called “${stageName(name)}”.`;
}

/**
 * The stages of a log, defined by the analyst: the stages in their order with their names, and
 * the stage of every activity of the parent's map. Everything is done with buttons, text fields
 * and lists of choices, so the keyboard reaches all of it. The stages are kept in the browser for
 * the reading and belong to no saved investigation; the editor says so.
 */
export function StagesEditor({ reading, parentGraph, store = browserStages }: StagesEditorProps) {
  const { definitions, kept } = useStages(reading, store);
  const [said, setSaid] = useState("");
  const [newName, setNewName] = useState("");
  const newNameId = useId();
  const stagesTitle = useId();
  const activitiesTitle = useId();
  const newField = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  /** The button a stage was moved with, until the list is drawn in its new order. */
  const movedWith = useRef<{ stageId: string; direction: "earlier" | "later" } | null>(null);
  // The most frequent activities first; activities of equal frequency by name.
  const listed = useMemo<ListedActivity[]>(
    () =>
      parentGraph.nodes
        .map((node) => ({ name: node.label, incidents: node.metrics.cases }))
        .sort((one, other) => other.incidents - one.incidents || one.name.localeCompare(other.name)),
    [parentGraph],
  );
  const inStage = (stage: Stage) => listed.filter((activity) => definitions.assigned.get(activity.name) === stage.id).length;
  const without = listed.filter((activity) => !definitions.assigned.has(activity.name)).length;
  const change = (next: (definitions: StageDefinitions) => StageDefinitions) => store.change(reading, next);

  // A stage that changes its place takes its row along, and a row that is moved loses the keyboard: it is given back to the button that moved it.
  useEffect(() => {
    const pressed = movedWith.current;
    movedWith.current = null;
    if (pressed === null) return;
    const row = Array.from(list.current?.children ?? []).find((item) => item.getAttribute("data-stage") === pressed.stageId);
    row?.querySelector<HTMLButtonElement>(`button[data-move="${pressed.direction}"]`)?.focus();
  }, [definitions]);

  function add(event: FormEvent) {
    event.preventDefault();
    const problem = nameProblem(definitions, newName);
    if (problem !== null) {
      setSaid(refusal(problem, newName));
      return;
    }
    change((current) => withStage(current, newName));
    setSaid(`Stage “${stageName(newName)}” added as stage ${definitions.stages.length + 1}.`);
    setNewName("");
  }

  function rename(stage: Stage, name: string): boolean {
    if (stageName(name) === stage.name) return true;
    const problem = nameProblem(definitions, name, stage.id);
    if (problem !== null) {
      setSaid(`${refusal(problem, name)} “${stage.name}” keeps its name.`);
      return false;
    }
    change((current) => renamed(current, stage.id, name));
    setSaid(`Stage “${stage.name}” is now called “${stageName(name)}”.`);
    return true;
  }

  function move(stage: Stage, place: number, direction: "earlier" | "later") {
    const to = direction === "earlier" ? place - 1 : place + 1;
    // The button at an end stays where the keyboard can reach it and does nothing there.
    if (to < 0 || to >= definitions.stages.length) return;
    movedWith.current = { stageId: stage.id, direction };
    change((current) => moved(current, stage.id, direction));
    setSaid(`“${stage.name}” is now stage ${to + 1} of ${definitions.stages.length}.`);
  }

  function remove(stage: Stage) {
    const held = inStage(stage);
    change((current) => withoutStage(current, stage.id));
    setSaid(`Stage “${stage.name}” removed.${held > 0 ? ` Its ${activities(held)} ${held === 1 ? "is" : "are"} in no stage now.` : ""}`);
    // The button that was pressed is gone with its stage; the keyboard goes on from the field for a new stage.
    newField.current?.focus();
  }

  return (
    <section className="stages-editor" aria-label="Stages of this log">
      <p className="stages-note">
        A stage holds activities that belong together in this log. The map draws a box around the activities of a stage, lays the stages out in the
        order given here, and offers “Show stages” in its Detail panel to draw each stage as one node. Start and End belong to no stage. Which
        stages there are and what belongs to them is yours to say for this log: nothing is built in, and nothing is derived from the records.
      </p>
      {kept ? (
        <p className="stages-note">
          The stages are kept in this browser for this reading. They are not yet part of a saved investigation, so another browser or another
          computer does not show them.
        </p>
      ) : (
        <p className="stages-note stages-not-kept">
          This browser keeps nothing for this page, so the stages last only until the page is closed or loaded again. They are not part of a saved
          investigation.
        </p>
      )}
      <div className="stages-parts">
        <div className="stages-part">
          <h4 id={stagesTitle} className="stages-title">
            Stages, the earliest first
          </h4>
          {definitions.stages.length === 0 ? (
            <p className="stages-note">No stage is defined for this log yet, so the map is drawn without stages.</p>
          ) : (
            <ol className="stages-list" aria-labelledby={stagesTitle} ref={list}>
              {definitions.stages.map((stage, place) => (
                <li key={stage.id} data-stage={stage.id}>
                  <div className="stages-stage">
                    <StageName stage={stage} place={place + 1} onRename={(name) => rename(stage, name)} />
                    <span className="stages-count">{activities(inStage(stage))}</span>
                    <span className="stages-actions">
                      <button
                        type="button"
                        aria-label={`Move “${stage.name}” earlier`}
                        data-move="earlier"
                        aria-disabled={place === 0 || undefined}
                        onClick={() => move(stage, place, "earlier")}
                      >
                        Earlier
                      </button>
                      <button
                        type="button"
                        aria-label={`Move “${stage.name}” later`}
                        data-move="later"
                        aria-disabled={place === definitions.stages.length - 1 || undefined}
                        onClick={() => move(stage, place, "later")}
                      >
                        Later
                      </button>
                      <button type="button" aria-label={`Remove the stage “${stage.name}”`} onClick={() => remove(stage)}>
                        Remove
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <form className="stages-add" onSubmit={add}>
            <label htmlFor={newNameId} className="stages-label">
              New stage
            </label>
            <input
              id={newNameId}
              ref={newField}
              className="stages-name"
              type="text"
              value={newName}
              autoComplete="off"
              onChange={(event) => setNewName(event.target.value)}
            />
            <button type="submit">Add stage</button>
          </form>
          <p role="status" className="stages-said">
            {said}
          </p>
        </div>
        <div className="stages-part">
          <h4 id={activitiesTitle} className="stages-title">
            Activities and their stage
          </h4>
          <p className="stages-note">
            {activities(listed.length)} on the map of every incident of the parent, the most frequent first
            {definitions.stages.length > 0 && `; ${without} in no stage`}.
          </p>
          <table className="stages-table" aria-labelledby={activitiesTitle}>
            <thead>
              <tr>
                <th scope="col">Activity</th>
                <th scope="col" className="stages-number">
                  Incidents
                </th>
                <th scope="col">Stage</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((activity) => (
                <tr key={activity.name}>
                  <th scope="row">{activity.name}</th>
                  <td className="stages-number">{integer.format(activity.incidents)}</td>
                  <td>
                    <select
                      className="stages-choice"
                      aria-label={`Stage of “${activity.name}”`}
                      value={definitions.assigned.get(activity.name) ?? ""}
                      disabled={definitions.stages.length === 0}
                      onChange={(event) => change((current) => withActivity(current, activity.name, event.target.value === "" ? null : event.target.value))}
                    >
                      <option value="">No stage</option>
                      {definitions.stages.map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {stage.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

interface StageNameProps {
  stage: Stage;
  /** The place of the stage among the stages, counted from one. */
  place: number;
  /** Renames the stage and says whether the name was given. */
  onRename: (name: string) => boolean;
}

/**
 * The name of a stage as a text field. The name is given when the field is left or Enter is
 * pressed, not at every key, since the map is arranged anew for every name it is given; Escape
 * brings the name back as it was.
 */
function StageName({ stage, place, onRename }: StageNameProps) {
  const [draft, setDraft] = useState(stage.name);
  useEffect(() => setDraft(stage.name), [stage.name]);

  function give() {
    if (onRename(draft)) setDraft(stageName(draft));
    else setDraft(stage.name);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      give();
    } else if (event.key === "Escape" && draft !== stage.name) {
      // The key takes the name back and goes no further: it does not also close what else the screen has open.
      event.preventDefault();
      setDraft(stage.name);
    }
  }

  return (
    <input
      className="stages-name"
      type="text"
      aria-label={`Name of stage ${place}`}
      value={draft}
      autoComplete="off"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={give}
      onKeyDown={onKeyDown}
    />
  );
}
