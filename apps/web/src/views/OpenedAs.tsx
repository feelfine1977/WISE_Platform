import { sameJson } from "../data/coordinator";
import { countOf } from "../data/wording";
import type { ViewState } from "../imported/coordinator";
import type { CategoryShare, ContextCategory, ContextColumn, ContextRemainder, OpeningContextAnswer } from "./messages";
import { ViewProblemNotice } from "./ViewProblemNotice";
import { percent, points, shareOf } from "./wording";

interface OpenedAsProps {
  state: ViewState<OpeningContextAnswer>;
  onRetry: () => void;
}

/** How the incidents were opened: each context column's value at the first record, beside the parent. */
export function OpenedAs({ state, onRetry }: OpenedAsProps) {
  return (
    <section className="view-panel" aria-labelledby="opened-as-title" aria-busy={state.phase === "loading"}>
      <h3 id="opened-as-title" className="view-title">
        Opened as
      </h3>
      {state.phase === "loading" && <p className="working-text">Reading the first record of every incident…</p>}
      {state.phase === "failed" && <ViewProblemNotice title="How the incidents were opened cannot be shown" problem={state.problem} onRetry={onRetry} />}
      {state.phase === "ready" && <Opening answer={state.answer} />}
    </section>
  );
}

function Opening({ answer }: { answer: OpeningContextAnswer }) {
  const { population, parent, columns } = answer.opening_context;
  const isParent = sameJson(answer.identity, answer.parent_identity);
  return (
    <>
      <p className="muted view-hint">
        The value of each context column at the first record of every incident, in the declared order. A value recorded later does not
        count.
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
      {columns.map((column) => (
        <OpeningColumn key={column.column_index} column={column} />
      ))}
    </>
  );
}

function OpeningColumn({ column }: { column: ContextColumn }) {
  const titleId = `opened-as-column-${column.column_index}`;
  const name = column.column_name.trim() === "" ? `Column ${column.column_index}` : column.column_name;
  return (
    <section className="opening-column" aria-labelledby={titleId}>
      <h4 id={titleId} className="opening-column-title">
        {name} <span className="muted">· {countOf(column.distinct_value_count, "recorded value")}</span>
      </h4>
      <ol className="opening-values" aria-label={`Opening values of ${name}, most frequent first`}>
        {column.categories.map((category) => (
          <ShareRow key={category.kind === "missing" ? "missing" : `value:${category.value}`} entry={category} />
        ))}
        {column.remainder && <ShareRow entry={column.remainder} />}
      </ol>
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

/** One value: its two thin bars, its counts, and the same with denominators for the tooltip and screen readers. */
function ShareRow({ entry }: { entry: ContextCategory | ContextRemainder }) {
  const { text, quiet } = label(entry);
  const difference = entry.difference_percentage_points;
  const described =
    `${text}. These incidents: ${shareOf(entry.population)}. Parent population: ${shareOf(entry.parent)}.` +
    (difference === null ? "" : ` Difference ${points(difference, "percentage points")}.`);
  return (
    <li className="opening-value" title={described}>
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
    </li>
  );
}

function barWidth(part: CategoryShare): number {
  return part.share === null ? 0 : part.share * 100;
}

function figure(part: CategoryShare): string {
  return part.share === null ? String(part.count) : `${part.count} (${percent(part.share)})`;
}
