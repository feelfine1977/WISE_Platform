import type { ExampleId, InputPolicies, PopulationAnswer, PopulationPartition, PopulationSupport } from "../generated/investigation";
import type { InvestigationState, PopulationState } from "../investigation/coordinator";
import { defaultExampleId, exampleIds } from "../investigation/policies";
import { countOf, countParts, partitionLabel } from "../investigation/wording";

interface PopulationStripProps {
  population: PopulationState;
  replacement: InvestigationState["replacement"];
  /** Whether a request of the current question is still unanswered. */
  pending: boolean;
  onChooseExample: (exampleId: ExampleId) => void;
}

/** The toolbar of the current question: where it is, its source, its status and the supplied facts. */
export function PopulationStrip({ population, replacement, pending, onChooseExample }: PopulationStripProps) {
  // The choice is what was asked for; the answer below can still be the one kept from an earlier choice.
  const exampleId = replacement ? replacement.asked : population.phase === "idle" ? defaultExampleId : population.exampleId;
  const answer = population.phase === "ready" ? population.answer : null;
  return (
    <section className="toolbar" aria-label="Source and population">
      <div className="toolbar-row">
        <div className="crumb">
          <span>Investigations</span>
          <span aria-hidden="true">/</span>
          <h1>Incident investigation</h1>
        </div>
        <div className="source-control">
          <label className="label" htmlFor="example-select">Source</label>
          <select id="example-select" value={exampleId} onChange={(event) => onChooseExample(event.target.value as ExampleId)}>
            {exampleIds.map((id) => (
              <option key={id} value={id}>Synthetic example {id}</option>
            ))}
          </select>
        </div>
        <div className="status-group">
          <span className="label" id="status-label">Status</span>
          <p role="status" aria-labelledby="status-label" className={`status status-${population.phase}`}>
            <StatusText population={population} replacement={replacement} />
          </p>
        </div>
      </div>
      {answer ? (
        <>
          <PopulationCounts answer={answer} />
          <DataDetails answer={answer} />
        </>
      ) : (
        <p className="toolbar-note">No population is shown until the current request is answered.</p>
      )}
      <div className="progress" hidden={!pending} aria-hidden="true" />
    </section>
  );
}

function StatusText({ population, replacement }: { population: PopulationState; replacement: InvestigationState["replacement"] }) {
  if (replacement && population.phase === "ready") {
    return replacement.phase === "running" ? (
      <>Showing revision {population.revision} · opening example {replacement.asked} · revision {replacement.revision}</>
    ) : (
      <>Showing revision {population.revision} · example {replacement.asked} not available · revision {replacement.revision}</>
    );
  }
  switch (population.phase) {
    case "idle":
      return <>Starting</>;
    case "loading":
      return <>Opening example {population.exampleId} · revision {population.revision}</>;
    case "ready":
      return <>Current answer · revision {population.revision}</>;
    case "failed":
      return <>Not available · revision {population.revision}</>;
  }
}

/** A supplied count as a figure with the unit it counts. */
function Figure({ count, unit }: { count: number; unit: "incident" | "record" }) {
  const parts = countParts(count, unit);
  return (
    <>
      <span className="figure">{parts.figure}</span> {parts.unit}
    </>
  );
}

function Count({ label, support }: { label: string; support: PopulationSupport }) {
  return (
    <div className="fact">
      <dt className="label">{label}</dt>
      <dd>
        <span className="fact-main">
          <Figure count={support.case_count} unit="incident" />
        </span>
        <span className="fact-sub">{countOf(support.record_count, "record")}</span>
      </dd>
    </div>
  );
}

function PopulationCounts({ answer }: { answer: PopulationAnswer }) {
  const { populations, coverage, policies } = answer;
  return (
    <dl className="facts">
      <Count label="Parent population" support={populations.parent} />
      <Count label={partitionLabel("kept", policies)} support={populations.kept} />
      <Count label={partitionLabel("removed", policies)} support={populations.removed} />
      <Count label="Unevaluable" support={populations.unevaluable} />
      <Count label="Outside the parent" support={populations.outside} />
      <Count label="All incidents in the source" support={populations.base} />
      <div className="fact">
        <dt className="label">Mapped sequence</dt>
        <dd>
          <span className="fact-main">
            <Figure count={coverage.mapped_record_count} unit="record" /> of {countOf(coverage.raw_record_count, "record")}
          </span>
          <span className="fact-sub">{countOf(coverage.omitted_activity_record_count, "record")} left out: no activity</span>
        </dd>
      </div>
    </dl>
  );
}

const membershipLabels: Record<keyof PopulationPartition, string> = {
  base: "All incidents in the source",
  parent: "Parent population",
  kept: "Kept",
  removed: "Removed",
  unevaluable: "Unevaluable",
  outside: "Outside the parent",
};

const policyLabels: Record<keyof InputPolicies, string> = {
  order: "Record order",
  activity_projection: "Activity sequence",
  context_projection: "Context",
  parent: "Parent population",
  predicate: "Kept and removed",
  comparison: "Comparison roles",
  missing_values: "Missing values",
  clock: "Clock",
  nullable_measure: "Unevaluable measures",
};

/** Identities, membership and policies of the current answer, exactly as supplied. */
function DataDetails({ answer }: { answer: PopulationAnswer }) {
  const identity = answer.identity;
  const identityRows: [string, string][] = [
    ["Source", identity.source_id],
    ["Preparation", identity.preparation_id],
    ["Representation", identity.representation_id],
    ["Case dictionary", identity.case_dictionary_id],
    ["Population", identity.population_id],
    ["Implementation version", identity.implementation_version],
    ["Request", answer.request_id],
    ["Query revision", String(answer.query_revision)],
    ["Example", answer.source.example_id],
    ["Snapshot cutoff", answer.source.snapshot_cutoff_utc],
  ];
  return (
    <details className="data-details">
      <summary className="disclosure">Data details</summary>
      <div className="details-panel" role="region" aria-label="Data details of the current answer" tabIndex={0}>
        <section aria-labelledby="details-identity">
          <h3 id="details-identity">Identity</h3>
          <dl className="pairs">
            {identityRows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd><code>{value}</code></dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-labelledby="details-membership">
          <h3 id="details-membership">Membership</h3>
          <dl className="pairs">
            {(Object.keys(membershipLabels) as (keyof PopulationPartition)[]).map((name) => {
              const support = answer.populations[name];
              return (
                <div key={name}>
                  <dt>
                    {membershipLabels[name]}: {countOf(support.case_count, "incident")}, {countOf(support.record_count, "record")}
                  </dt>
                  <dd>{support.case_ids.length > 0 ? support.case_ids.join(", ") : "No incidents"}</dd>
                </div>
              );
            })}
          </dl>
        </section>
        <section aria-labelledby="details-policies">
          <h3 id="details-policies">Policies</h3>
          <dl className="pairs">
            {(Object.keys(policyLabels) as (keyof InputPolicies)[]).map((name) => {
              const policy = answer.policies[name];
              return (
                <div key={name}>
                  <dt>{policyLabels[name]}</dt>
                  <dd>
                    <code>{policy.id}</code>
                    <ul className="parameters">
                      {Object.entries(policy.parameters).map(([key, value]) => (
                        <li key={key}>
                          {key}: <code>{String(value)}</code>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      </div>
    </details>
  );
}
