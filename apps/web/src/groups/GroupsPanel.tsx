import { useEffect, useId, useMemo, useState } from "react";
import { countOf } from "../data/wording";
import type { RuleGroup, RuleGroupsAnswer, RuleGroupsRequest } from "../generated/rule-groups";
import type { AnswerIdentity } from "../generated/selection";
import { ColumnChart } from "../time/ColumnChart";
import { durationName, SPAN_EDGES_HOURS, spanBinLabel } from "../time/periods";
import { answersRuleGroups, httpRuleGroupsClient, type RuleGroupsClient } from "./client";
import { groupLabel, groupRuleSentence, readsOrder, ruleChoices, ruleSentence, shownGroup } from "./rules";
import "./groups.css";

/** How many groups one page holds; the service gives at most 50 at once. */
export const GROUP_PAGE = 50;
/** How many of the largest groups the line of their cover counts. */
const COVER_OF = 20;

interface GroupsPanelProps {
  workspaceId: string;
  revision: number;
  /** The identity of the kept incidents: the groups count them, in the catalogue of their parent. */
  identity: AnswerIdentity;
  contextColumns: readonly { index: number; name: string }[];
  /** The activities of the parent's map, the most frequent first: each can group the incidents with it and without it. */
  activities?: readonly string[];
  /** Opens an incident in the inspector, as a row of the table does. */
  onOpen?: (caseId: string) => void;
  /** The group whose incidents the table shows, by its id; null while it shows every kept incident. */
  chosen: string | null;
  onChoose: (group: { id: string; label: string; caseIds: readonly string[] } | null) => void;
  client?: RuleGroupsClient;
}

type Listed = { phase: "loading" } | { phase: "ready"; answer: RuleGroupsAnswer; groups: RuleGroup[] } | { phase: "failed"; message: string };

const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });

/**
 * The kept incidents grouped by a rule the analyst states: the groups ranked as the local service
 * ranks them in the catalogue of the parent, each with its incidents and their share. Choosing a
 * group only shows its incidents in the table; keeping or removing them is a step taken there.
 */
export function GroupsPanel({ workspaceId, revision, identity, contextColumns, activities = [], onOpen, chosen, onChoose, client = httpRuleGroupsClient }: GroupsPanelProps) {
  const asked = useId();
  const choices = useMemo(() => ruleChoices(contextColumns, activities), [contextColumns, activities]);
  const [ruleValue, setRuleValue] = useState(choices[0].value);
  const rule = (choices.find((choice) => choice.value === ruleValue) ?? choices[0]).rule;
  const [offset, setOffset] = useState(0);
  // A failed page of groups is asked again on request; the rule and the kept incidents stay as they are.
  const [attempt, setAttempt] = useState(0);
  const [listed, setListed] = useState<Listed>({ phase: "loading" });
  const identityKey = JSON.stringify(identity);
  const ruleKey = JSON.stringify(rule);

  useEffect(() => setOffset(0), [ruleKey, identityKey, revision]);

  useEffect(() => {
    const controller = new AbortController();
    const request: RuleGroupsRequest = {
      schema_version: 1, message_type: "rule_groups_request", request_id: `groups-${asked}-${revision}-${offset}-${attempt}`, query_revision: revision,
      workspace_id: workspaceId, identity, query: { rule, distribution_edges_hours: SPAN_EDGES_HOURS, offset, limit: GROUP_PAGE },
    };
    if (offset === 0) setListed({ phase: "loading" });
    client.groups(request, controller.signal).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        if (!outcome.ok || !answersRuleGroups(request, outcome.answer)) {
          setListed({ phase: "failed", message: !outcome.ok && outcome.problem.kind === "refusal" ? outcome.problem.refusal.message : "The groups could not be read from the local service." });
          return;
        }
        const answer = outcome.answer;
        setListed((current) => ({ phase: "ready", answer, groups: offset > 0 && current.phase === "ready" ? [...current.groups, ...answer.groups] : answer.groups }));
      },
      () => !controller.signal.aborted && setListed({ phase: "failed", message: "The groups could not be read from the local service." }),
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, workspaceId, revision, identityKey, ruleKey, offset, asked, attempt]);

  const answer = listed.phase === "ready" ? listed.answer : null;
  const groups = listed.phase === "ready" ? listed.groups.filter((group) => shownGroup(group.key)) : [];
  // The band below one record is the first of its catalogue and is never shown, so it is not counted either.
  const groupCount = answer === null ? 0 : answer.group_count - (rule.kind === "raw_record_count_bands" ? 1 : 0);
  const largest = Math.max(1, ...groups.map((group) => group.population.cases.case_count));
  // The groups stand in the order of the parent's catalogue. Where they do not overlap, the shares of the parent's largest
  // groups add up to how much of the kept incidents those groups hold; the line names that ranking, which is not the kept one.
  // Where no kept incident is eligible, every share is unavailable: no cover is said, never a share of none.
  const cover = answer !== null && !answer.group_membership_overlaps && answer.population_coverage.eligible.case_count > 0
    ? groups.slice(0, COVER_OF).reduce((sum, group) => sum + (group.population.share ?? 0), 0)
    : null;
  // Who the rule cannot place, said apart: incidents it cannot evaluate, and evaluated incidents it puts in no group, among the kept and in the parent.
  const coverage = answer === null ? null : { kept: answer.population_coverage, parent: answer.parent_coverage };
  const columnName = (index: number) => contextColumns.find((column) => column.index === index)?.name ?? `column ${index + 1}`;
  const references = answer?.shared_reference_coverage ?? null;

  return (
    <section className="groups-panel" aria-label="Groups of the kept cases">
      <label className="groups-rule">
        <span>Grouped by</span>
        <select
          value={ruleValue}
          onChange={(event) => {
            setRuleValue(event.target.value);
            onChoose(null);
          }}
        >
          {choices
            .filter((choice) => choice.rule.kind !== "activity_presence")
            .map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          {activities.length > 0 && (
            <optgroup label="With or without an activity">
              {choices
                .filter((choice) => choice.rule.kind === "activity_presence")
                .map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
            </optgroup>
          )}
        </select>
      </label>
      <p className="groups-rule-said">{ruleSentence(rule, columnName)}</p>
      <p className="muted groups-actions-said">
        Grouping puts whole cases together by the rule chosen. Choosing a group lists its cases in the table and changes nothing; Keep or Remove
        takes a step with exactly its cases; Compare as A or B makes it a side of a comparison without changing the selection.
      </p>
      {listed.phase === "loading" && <p className="working-text">Grouping the kept cases…</p>}
      {listed.phase === "failed" && (
        <div className="inline-error" role="alert">
          <p>{listed.message}</p>
          <button
            type="button"
            onClick={() => {
              // The groups are read again from their first page, so that no page of the catalogue is missing.
              setOffset(0);
              setAttempt((count) => count + 1);
            }}
          >
            Ask again
          </button>
        </div>
      )}
      {answer !== null && (
        <>
          <p className="groups-summary">
            {countOf(groupCount, "group")}
            {cover !== null &&
              groups.length > 1 &&
              ` · the parent's largest ${Math.min(COVER_OF, groups.length)} hold ${percent.format(cover)} of the ${groups[0].population.denominator.toLocaleString("en")} eligible kept cases`}
          </p>
          {coverage !== null && (
            <p className="groups-eligible">
              Eligible for the rule: {coverage.kept.eligible.case_count.toLocaleString("en")} of {countOf(coverage.kept.total.case_count, "kept case")}, and{" "}
              {coverage.parent.eligible.case_count.toLocaleString("en")} of {countOf(coverage.parent.total.case_count, "case")} in the parent.
            </p>
          )}
          {coverage !== null && (coverage.kept.unevaluable.case_count > 0 || coverage.parent.unevaluable.case_count > 0) && (
            <p className="groups-limit">
              {countOf(coverage.kept.unevaluable.case_count, "case")} the rule cannot evaluate (parent {coverage.parent.unevaluable.case_count.toLocaleString("en")})
              {readsOrder(rule) && ": the order of their records is not fully known"}
            </p>
          )}
          {coverage !== null && (coverage.kept.unassigned.case_count > 0 || coverage.parent.unassigned.case_count > 0) && (
            <p className="groups-limit">
              {countOf(coverage.kept.unassigned.case_count, "case")} in no group (parent {coverage.parent.unassigned.case_count.toLocaleString("en")})
              {rule.kind === "shared_reference" && `: each value of ${columnName(rule.column_index)} they have is recorded in too few cases of the parent`}
            </p>
          )}
          {references !== null && (
            <p className="groups-limit">
              {countOf(references.population_missing_reference_record_count, "record")} of the kept cases without a value of {columnName(references.column_index)}{" "}
              (parent {references.parent_missing_reference_record_count.toLocaleString("en")}); {references.parent_suppressed_nonmissing_value_count.toLocaleString("en")} of the{" "}
              {countOf(references.parent_distinct_nonmissing_value_count, "value")} in the parent form no group.
            </p>
          )}
          <p className="muted groups-note">A group is what its stated rule puts together: it is not a business class, and a difference between groups is not a cause.</p>
          <ol className="groups-list">
            {groups.map((group) => {
              const label = groupLabel(group.key);
              const count = group.population.cases.case_count;
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    className="groups-row"
                    aria-pressed={chosen === group.id}
                    title={label}
                    onClick={() => onChoose(chosen === group.id ? null : { id: group.id, label, caseIds: group.population.cases.case_ids })}
                  >
                    <span className="groups-name">{label}</span>
                    <span className="groups-count">{count.toLocaleString("en")}</span>
                    <svg className="groups-bar" viewBox="0 0 100 3" preserveAspectRatio="none" aria-hidden="true">
                      <rect className="groups-bar-track" x={0} y={0} width={100} height={3} />
                      <rect className="groups-bar-share" x={0} y={0} width={(count / largest) * 100} height={3} />
                    </svg>
                  </button>
                  {chosen === group.id && <GroupDetail group={group} rule={groupRuleSentence(group.key, rule, columnName)} onOpen={onOpen} />}
                </li>
              );
            })}
          </ol>
          {answer.next_offset !== null && (
            <button type="button" className="groups-more" onClick={() => setOffset(answer.next_offset ?? offset)}>
              Show more groups
            </button>
          )}
        </>
      )}
    </section>
  );
}

/**
 * What a chosen group rests on, as supplied: its rule, its incidents in the parent and among the
 * kept ones with their shares, the recorded spans and longest gaps of its incidents against the
 * parent's, and its shortest and longest incident, each of which opens in the inspector.
 */
function GroupDetail({ group, rule, onOpen }: { group: RuleGroup; rule: string; onOpen?: (caseId: string) => void }) {
  const share = (value: number | null) => (value === null ? "–" : percent.format(value));
  const spans = group.span_distribution;
  const gaps = group.gap_distribution;
  const exemplars = group.exemplars;
  return (
    <div className="groups-detail">
      <p className="groups-detail-rule">{rule}</p>
      <dl className="groups-figures">
        <div>
          <dt>In the parent</dt>
          <dd>
            {/* A share is supplied against the incidents the rule can place, the eligible ones; the figure names that denominator. */}
            {group.parent.cases.case_count.toLocaleString("en")} of {group.parent.denominator.toLocaleString("en")} eligible · {share(group.parent.share)}
          </dd>
        </div>
        <div>
          <dt>Kept</dt>
          <dd>
            {group.population.cases.case_count.toLocaleString("en")} of {group.population.denominator.toLocaleString("en")} eligible · {share(group.population.share)}
          </dd>
        </div>
      </dl>
      {/* The pale columns are every incident of the parent, not only the group's: the group is read against the whole parent. */}
      <GroupDistribution title="Recorded span: the group's kept cases, dark, against every case of the parent, pale" name="Recorded spans of the group's kept cases against the whole parent" distribution={spans} unavailable="without a span" />
      <GroupDistribution title="Longest gap: the group's kept cases, dark, against every case of the parent, pale" name="Longest gaps of the group's kept cases against the whole parent" distribution={gaps} unavailable="without a gap" />
      {exemplars.status === "available" ? (
        <p className="groups-exemplars">
          {(["shortest", "longest"] as const).map((which) => {
            const exemplar = exemplars[which];
            return (
              <button key={which} type="button" className="link-button" disabled={!onOpen} onClick={() => onOpen?.(exemplar.case_id)}>
                {which === "shortest" ? "Shortest" : "Longest"}: {exemplar.case_id}, {durationName(exemplar.observed_span_hours)}
              </button>
            );
          })}
        </p>
      ) : (
        <p className="muted groups-exemplars">{exemplars.reason === "empty_current_group" ? "No kept case is in this group." : "No case of this group has a known order."}</p>
      )}
    </div>
  );
}

/** One supplied distribution of a group: the whole parent pale and the group's kept incidents solid, read only, with the kept incidents it cannot place. */
function GroupDistribution({ title, name, distribution, unavailable }: { title: string; name: string; distribution: RuleGroup["span_distribution"]; unavailable: string }) {
  const bins = distribution.bins.map((bin) => ({ label: spanBinLabel(bin.start_inclusive_hours, bin.end_exclusive_hours), parent: bin.parent_case_count, kept: bin.kept_case_count }));
  if (bins.length === 0) return null;
  return (
    <div className="groups-distribution">
      <p className="groups-distribution-title">{title}</p>
      <ColumnChart
        name={name}
        readOnly
        bins={bins}
        band={false}
        applicable={() => false}
        chosenName={(from) => bins[from].label}
        stepName={() => ""}
        onApply={() => undefined}
        ticks={[bins[0].label, bins[bins.length - 1].label]}
      />
      {distribution.unavailable.kept_case_count > 0 && <p className="groups-limit">{countOf(distribution.unavailable.kept_case_count, "case")} {unavailable}</p>}
    </div>
  );
}
