import { type ComponentProps, useEffect, useId, useRef, useState } from "react";
import type { SelectionPredicate } from "../generated/selection";
import { FilterPanel } from "./FilterPanel";
import { STEP_KINDS, type StepKind } from "./Filters";
import "./filters.css";

/** The line that says what a step is, wherever steps are offered. */
export const STEP_GLOSS = "A step keeps or removes whole incidents: every record of a kept incident stays with it, and Undo takes a step back.";

type AddStepProps = Omit<ComponentProps<typeof FilterPanel>, "only" | "previewStep"> & {
  /** A new number opens the panel, as the line of guidance asks. */
  openRequest?: number;
};

/**
 * The one entry from which every way of keeping or removing incidents by a value starts: "+ Add step" opens a short list
 * of the kinds of step, each opens its form, and applying adds the step at once, with Undo. The panel closes after a step
 * and gives the focus back to the entry; Escape closes it too.
 */
export function AddStep(props: AddStepProps) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<StepKind | null>(null);
  const entry = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setKind(null);
    entry.current?.focus();
  };

  useEffect(() => {
    if (props.openRequest) setOpen(true);
  }, [props.openRequest]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // The focus goes to what was opened: the list of kinds, or the form of the kind chosen.
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("button, input, select, textarea")?.focus();
  }, [open, kind]);

  return (
    <div className="add-step">
      <button type="button" ref={entry} className="add-step-entry" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => (open ? close() : setOpen(true))}>
        + Add step
      </button>
      {open && (
        <div id={panelId} className="add-step-panel" role="group" aria-label="Add a step" ref={panel}>
          <p className="add-step-gloss">{STEP_GLOSS}</p>
          {kind === null ? (
            <ul className="add-step-kinds" aria-label="Kinds of step">
              {(Object.keys(STEP_KINDS) as StepKind[]).map((key) => (
                <li key={key}>
                  <button type="button" onClick={() => setKind(key)}>{STEP_KINDS[key]}</button>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p className="add-step-title">
                <strong>{STEP_KINDS[kind]}</strong>{" "}
                <button type="button" className="link-button" onClick={() => setKind(null)}>Other kinds of step</button>
              </p>
              <FilterPanel {...props} only={kind} onStep={(step: SelectionPredicate) => { props.onStep(step); close(); }} />
            </>
          )}
          <button type="button" className="add-step-close" onClick={close}>Close</button>
        </div>
      )}
    </div>
  );
}
