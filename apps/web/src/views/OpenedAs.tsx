import { type ReactNode, useEffect, useRef, useState } from "react";
import { sameJson } from "../data/coordinator";
import { countOf } from "../data/wording";
import type { SelectionPredicate } from "../generated/selection";
import type { StepPreview, ViewState } from "../imported/coordinator";
import { StepPreviewLine, type StepPreviewer } from "../map/StepPreviewLine";
import type { CategoryShare, ContextCategory, ContextColumn, ContextRemainder, OpeningContextAnswer } from "./messages";
import { ViewProblemNotice } from "./ViewProblemNotice";
import { percent, points, shareOf } from "./wording";

interface OpenedAsProps {
  state: ViewState<OpeningContextAnswer>;
  onRetry: () => void;
  /** The id of the text saying why trying again has to wait, while it has to. */
  waitingFor?: string;
  /** Takes a step that keeps the incidents first recorded with the values chosen; without it the values are only shown. */
  onStep?: (step: SelectionPredicate) => void;
  /** Counts, before anything is taken, what a step would keep; with it a choice is previewed and applied on request, and a value can be inspected. */
  previewStep?: StepPreviewer;
  /** Opens one incident with its whole history beside the panel. */
  onOpenCase?: (caseId: string) => void;
  /** The incident open beside the panel, if any; when the one opened from here closes, the focus returns to its button. */
  openCaseId?: string | null;
}

/** What the panel can do with a value, beyond showing it. */
interface Actions {
  onStep: (step: SelectionPredicate) => void;
  previewStep?: StepPreviewer;
  onOpenCase?: (caseId: string) => void;
  waitingFor?: string;
}

const ANCHOR = "incident.context.first_record_in_declared_order.v1";

/** Each context column's value at the first recorded observation of the incidents, beside the parent. */
export function OpenedAs({ state, onRetry, waitingFor, onStep, previewStep, onOpenCase, openCaseId = null }: OpenedAsProps) {
  const root = useRef<HTMLElement>(null);
  const opener = useRef<string | null>(null);
  // Back from an incident opened here, the focus returns to the button it was opened with.
  useEffect(() => {
    if (openCaseId !== null || opener.current === null) return;
    const caseId = opener.current;
    opener.current = null;
    [...(root.current?.querySelectorAll<HTMLElement>("[data-open-case]") ?? [])].find((button) => button.dataset.openCase === caseId)?.focus();
  }, [openCaseId]);
  const open = onOpenCase && ((caseId: string) => { opener.current = caseId; onOpenCase(caseId); });
  const actions = onStep ? { onStep, previewStep, onOpenCase: open, waitingFor } : undefined;
  return (
    <section className="view-panel" aria-labelledby="opened-as-title" aria-busy={state.phase === "loading"} ref={root}>
      <h3 id="opened-as-title" className="view-title">
        At the first recorded observation
      </h3>
      {state.phase === "loading" && <p className="working-text">Reading the first record of every incident…</p>}
      {state.phase === "failed" && <ViewProblemNotice title="The first recorded observations cannot be shown" problem={state.problem} onRetry={onRetry} waitingFor={waitingFor} />}
      {state.phase === "ready" && <Opening answer={state.answer} actions={actions} />}
    </section>
  );
}

function Opening({ answer, actions }: { answer: OpeningContextAnswer; actions?: Actions }) {
  const { population, parent, columns } = answer.opening_context;
  const isParent = sameJson(answer.identity, answer.parent_identity);
  return (
    <>
      <p className="muted view-hint">
        The value of each context column at the first recorded observation of every incident, in the declared order. It is the first record, not a
        business event such as an opening, and not the first value that is filled in: a value recorded later does not count.
      </p>
      <p className="muted view-hint">
        Policy: <code className="identifier">{answer.opening_context.anchor_policy}</code>
      </p>
      <ul className="share-legend" aria-label="Bars">
        <li>
          <span className="swatch swatch-population" aria-hidden="true" />
          These incidents: {countOf(population.evaluable_case_count, "incident")} with a readable first record
        </li>
        <li>
          <span className="swatch swatch-parent" aria-hidden="true" />
          Parent population: {countOf(parent.evaluable_case_count, "incident")} with a readable first record
        </li>
      </ul>
      {isParent && <p className="muted view-hint">These incidents are the whole parent population, so both bars are the same.</p>}
      {parent.unevaluable_case_count > 0 && (
        <p className="order-note">
          {countOf(parent.unevaluable_case_count, "incident")} of the parent {parent.unevaluable_case_count === 1 ? "has" : "have"} no readable
          first record because {parent.unevaluable_case_count === 1 ? "its" : "their"} order is not known
          {!isParent && population.unevaluable_case_count > 0 && <>, {countOf(population.unevaluable_case_count, "incident")} of them among these incidents</>}
          ; {parent.unevaluable_case_count === 1 ? "it is" : "they are"} in no share.
        </p>
      )}
      {parent.tied_first_record_case_count > 0 && (
        <p className="order-note">
          {countOf(parent.tied_first_record_case_count, "incident")} of the parent {parent.tied_first_record_case_count === 1 ? "has" : "have"} a first
          record that shares its time with the next record
          {!isParent && <>, {countOf(population.tied_first_record_case_count, "incident")} of them among these incidents</>}: the declared order
          decides which is first, by the sequence number, then by the place in the file. A different sequence column, chosen in the Data area,
          would decide differently.
        </p>
      )}
      <p className="muted view-hint">
        Only the value at the first recorded observation is shown. The latest value and any value ever recorded are not offered here: an incident can
        hold several values over its records, so their shares would overlap.
      </p>
      {columns.map((column) => (
        <OpeningColumn key={`${column.column_index}:${JSON.stringify(answer.identity)}`} column={column} evaluable={population.evaluable_case_count} actions={actions} />
      ))}
    </>
  );
}

/** The key of a value: a missing value and the text "missing" are never the same. */
function keyOf(category: ContextCategory): string {
  return category.kind === "missing" ? "missing" : `value:${category.value}`;
}

function OpeningColumn({ column, evaluable, actions }: { column: ContextColumn; evaluable: number; actions?: Actions }) {
  const titleId = `opened-as-column-${column.column_index}`;
  const name = column.column_name.trim() === "" ? `Column ${column.column_index}` : column.column_name;
  const [view, setView] = useState<"bars" | "table">("bars");
  const [chosen, setChosen] = useState<string[]>([]);
  const [pending, setPending] = useState<SelectionPredicate | null>(null);
  const [inspected, setInspected] = useState<ContextCategory | null>(null);
  const categories = column.categories;
  const chosenCategories = categories.filter((category) => chosen.includes(keyOf(category)));
  const fixed = categories.length === 1 && column.remainder === null && categories[0].parent.share === 1;
  const stepOf = (picked: ContextCategory[]): SelectionPredicate => ({
    kind: "opening_attribute_in",
    column_index: column.column_index,
    values: picked.map((category) => category.value) as [string | null, ...(string | null)[]],
    negate: false,
    anchor_policy: ANCHOR,
  });
  const toggle = (category: ContextCategory) => {
    setPending(null);
    setChosen((current) => (current.includes(keyOf(category)) ? current.filter((key) => key !== keyOf(category)) : [...current, keyOf(category)]));
  };
  const rowActions = (category: ContextCategory) =>
    actions && (
      <span className="opening-actions">
        <label className="check">
          <input type="checkbox" checked={chosen.includes(keyOf(category))} onChange={() => toggle(category)} />
          Choose {label(category).text}
        </label>
        {actions.previewStep && (
          <button type="button" onClick={() => setInspected(category)} aria-pressed={inspected !== null && keyOf(inspected) === keyOf(category)}>
            Inspect {label(category).text}
          </button>
        )}
      </span>
    );
  return (
    <section className="opening-column" aria-labelledby={titleId}>
      <h4 id={titleId} className="opening-column-title">
        {name} <span className="muted">· {countOf(column.distinct_value_count, "recorded value")}</span>
      </h4>
      <div className="view-switch" role="group" aria-label={`View of ${name}`}>
        <button type="button" aria-pressed={view === "bars"} onClick={() => setView("bars")}>
          Bars
        </button>
        <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>
          Table
        </button>
      </div>
      {fixed && (
        <p className="muted view-hint">
          Fixed in the parent: every incident with a readable first record has {label(categories[0]).text} here, so this column cannot tell incidents apart.
        </p>
      )}
      {view === "bars" ? (
        <ol className="opening-values" aria-label={`Opening values of ${name}, most frequent first`}>
          {categories.map((category) => (
            <ShareRow key={keyOf(category)} entry={category} chosen={chosen.includes(keyOf(category))}>
              {rowActions(category)}
            </ShareRow>
          ))}
          {column.remainder && <ShareRow entry={column.remainder} />}
        </ol>
      ) : (
        <table className="plain-table compact-table opening-table" aria-label={`Opening values of ${name}, as a table`}>
          <thead>
            <tr>
              <th scope="col">Value</th>
              <th scope="col" className="number">These incidents</th>
              <th scope="col" className="number">Parent population</th>
              <th scope="col" className="number">Difference</th>
              {actions && <th scope="col">Choose or inspect</th>}
            </tr>
          </thead>
          <tbody>
            {[...categories, ...(column.remainder ? [column.remainder] : [])].map((entry) => (
              <tr key={"kind" in entry ? keyOf(entry) : "remainder"}>
                <th scope="row" className={label(entry).quiet ? "missing-text" : undefined}>{label(entry).text}</th>
                <td className="number">{shareOf(entry.population)}</td>
                <td className="number">{shareOf(entry.parent)}</td>
                <td className="number">{entry.difference_percentage_points === null ? "–" : points(entry.difference_percentage_points, "points")}</td>
                {actions && <td>{"kind" in entry ? rowActions(entry) : <span className="muted">several values: none can be chosen</span>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted view-hint">
        Each incident with a readable first record has exactly one value here: the values listed
        {column.remainder ? " and the other values" : ""} add up to {countOf(sum(column), "incident")} of {countOf(evaluable, "incident")}.
      </p>
      {actions && inspected && actions.previewStep && (
        <Inspection category={inspected} name={name} step={stepOf([inspected])} previewer={actions.previewStep} onOpenCase={actions.onOpenCase} onClose={() => setInspected(null)} />
      )}
      {actions && chosenCategories.length > 0 && !pending && (
        <div className="opening-choice">
          <p>
            Chosen: {chosenCategories.map((category) => label(category).text).join(" or ")}. Values chosen together are alternatives (or); the step joins any
            other step by and.
          </p>
          <button type="button" disabled={actions.waitingFor !== undefined} aria-describedby={actions.waitingFor}
            onClick={() => (actions.previewStep ? setPending(stepOf(chosenCategories)) : (actions.onStep(stepOf(chosenCategories)), setChosen([])))}>
            {actions.previewStep ? "Preview keeping incidents first recorded with these values" : "Keep incidents first recorded with these values"}
          </button>
        </div>
      )}
      {actions && pending && actions.previewStep && (
        <div className="filter-preview" role="group" aria-label={`Values of ${name} not yet applied`}>
          <StepPreviewLine id={`${titleId}-preview`} step={pending} previewer={actions.previewStep} />
          <button type="button" className="primary" disabled={actions.waitingFor !== undefined} aria-describedby={[actions.waitingFor, `${titleId}-preview`].filter(Boolean).join(" ")}
            onClick={() => { actions.onStep(pending); setPending(null); setChosen([]); }}>
            Apply
          </button>
          <button type="button" onClick={() => setPending(null)}>Cancel</button>
        </div>
      )}
    </section>
  );
}

/** The incidents of the selection shown that are first recorded with one value; looking at them changes nothing. */
function Inspection({ category, name, step, previewer, onOpenCase, onClose }: {
  category: ContextCategory; name: string; step: SelectionPredicate; previewer: StepPreviewer; onOpenCase?: (caseId: string) => void; onClose: () => void;
}) {
  const [found, setFound] = useState<StepPreview | null>(null);
  const key = JSON.stringify(step);
  useEffect(() => {
    const controller = new AbortController();
    setFound(null);
    previewer(step, controller.signal).then((outcome) => !controller.signal.aborted && setFound(outcome));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, previewer]);
  const title = `Incidents first recorded with ${name} ${label(category).text}`;
  return (
    <section className="opening-inspection" aria-label={title}>
      <p className="label-text-strong">{title}</p>
      <p className="muted">Inspecting changes nothing: the selection and its steps stay as they are.</p>
      {found === null && <p className="muted">Finding these incidents…</p>}
      {found !== null && !found.ok && <p className="muted">These incidents cannot be found now.</p>}
      {found !== null && found.ok && (
        <ul aria-label={title}>
          {found.keptIds.map((caseId) => (
            <li key={caseId}>
              {onOpenCase ? <button type="button" data-open-case={caseId} onClick={() => onOpenCase(caseId)}>{caseId}</button> : caseId}
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onClose}>Stop inspecting</button>
    </section>
  );
}

function label(entry: ContextCategory | ContextRemainder): { text: string; quiet: boolean } {
  if ("kind" in entry) {
    if (entry.value === null) return { text: "not recorded", quiet: true };
    // A recorded value of blanks only is a value of its own; it is shown so that it can be seen.
    if (entry.value.trim() === "") return { text: `“${entry.value}” (blank text)`, quiet: true };
    return { text: entry.value, quiet: false };
  }
  return { text: `${countOf(entry.distinct_value_count, "other value")}`, quiet: true };
}

/** The incidents of these incidents counted under some value of a column, the remainder included. */
function sum(column: ContextColumn): number {
  return column.categories.reduce((total, category) => total + category.population.count, 0) + (column.remainder?.population.count ?? 0);
}

/** One value: its two thin bars, its counts, and the same with denominators for the tooltip and screen readers. */
function ShareRow({ entry, chosen = false, children }: { entry: ContextCategory | ContextRemainder; chosen?: boolean; children?: ReactNode }) {
  const { text, quiet } = label(entry);
  const difference = entry.difference_percentage_points;
  const described =
    `${text}. These incidents: ${shareOf(entry.population)}. Parent population: ${shareOf(entry.parent)}.` +
    (difference === null ? "" : ` Difference ${points(difference, "percentage points")}.`);
  return (
    <li className={chosen ? "opening-value opening-chosen" : "opening-value"} title={described}>
      <span className={quiet ? "opening-label missing-text" : "opening-label"} aria-hidden="true">
        {text}
      </span>
      <svg className="share-bars" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <rect className="share-track" x="0" y="0" width="100" height="4" />
        <rect className="share-bar-population" x="0" y="0" width={barWidth(entry.population)} height="4" />
        <rect className="share-track" x="0" y="6" width="100" height="4" />
        <rect className="share-bar-parent" x="0" y="6" width={barWidth(entry.parent)} height="4" />
      </svg>
      <span className="opening-figures" aria-hidden="true">
        {figure(entry.population)} <span className="muted">· {figure(entry.parent)}</span>
      </span>
      <span className="visually-hidden">{described}</span>
      {children}
    </li>
  );
}

function barWidth(part: CategoryShare): number {
  return part.share === null ? 0 : part.share * 100;
}

function figure(part: CategoryShare): string {
  return part.share === null ? String(part.count) : `${part.count} (${percent(part.share)})`;
}
