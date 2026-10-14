import { useEffect, useId, useMemo, useState } from "react";
import { countOf } from "../data/wording";
import type { RuleGroup, RuleGroupsAnswer, RuleGroupsRequest } from "../generated/rule-groups";
import type { AnswerIdentity } from "../generated/selection";
import { ColumnChart } from "../time/ColumnChart";
import { durationName, SPAN_EDGES_HOURS, spanBinLabel } from "../time/periods";
import { answersRuleGroups, httpRuleGroupsClient, type RuleGroupsClient } from "./client";
import { groupLabel, ruleChoices } from "./rules";
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
  const groups = listed.phase === "ready" ? listed.groups : [];
  const largest = Math.max(1, ...groups.map((group) => group.population.cases.case_count));
  // The groups stand in the order of the parent's catalogue. Where they do not overlap, the shares of the parent's largest
  // groups add up to how much of the kept incidents those groups hold; the line names that ranking, which is not the kept one.
  const cover = answer !== null && !answer.group_membership_overlaps
    ? groups.slice(0, COVER_OF).reduce((sum, group) => sum + (group.population.share ?? 0), 0)
    : null;
  // Who the rule cannot place, said apart: incidents it cannot evaluate, and evaluated incidents it puts in no group, among the kept and in the parent.
  const coverage = answer === null ? null : { kept: answer.population_coverage, parent: answer.parent_coverage };

  return (
    <section className="groups-panel" aria-label="Groups of the kept incidents">
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
      {listed.phase === "loading" && <p className="working-text">Grouping the kept incidents…</p>}
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
            {countOf(answer.group_count, "group")}
            {cover !== null && groups.length > 1 && ` · the parent's largest ${Math.min(COVER_OF, groups.length)} hold ${percent.format(cover)} of the eligible kept incidents`}
          </p>
          {coverage !== null && (coverage.kept.unevaluable.case_count > 0 || coverage.parent.unevaluable.case_count > 0) && (
            <p className="groups-limit">
              {countOf(coverage.kept.unevaluable.case_count, "incident")} the rule cannot evaluate (parent {coverage.parent.unevaluable.case_count.toLocaleString("en")})
            </p>
          )}
          {coverage !== null && (coverage.kept.unassigned.case_count > 0 || coverage.parent.unassigned.case_count > 0) && (
            <p className="groups-limit">
              {countOf(coverage.kept.unassigned.case_count, "incident")} in no group (parent {coverage.parent.unassigned.case_count.toLocaleString("en")})
            </p>
          )}
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
                  {chosen === group.id && <GroupDetail group={group} onOpen={onOpen} />}
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
 * What a chosen group rests on, as supplied: its incidents in the parent and among the kept ones
 * with their shares, the recorded spans of its incidents against the parent's, and its shortest and
 * longest incident, each of which opens in the inspector.
 */
function GroupDetail({ group, onOpen }: { group: RuleGroup; onOpen?: (caseId: string) => void }) {
  const share = (value: number | null) => (value === null ? "–" : percent.format(value));
  const spans = group.span_distribution;
  const gaps = group.gap_distribution;
  const exemplars = group.exemplars;
  return (
    <div className="groups-detail">
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
      <GroupDistribution title="Recorded span" name="Recorded spans of the group, parent and kept" distribution={spans} unavailable="without a span" />
      <GroupDistribution title="Longest gap" name="Longest gaps of the group, parent and kept" distribution={gaps} unavailable="without a gap" />
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
        <p className="muted groups-exemplars">{exemplars.reason === "empty_current_group" ? "No kept incident is in this group." : "No incident of this group has a known order."}</p>
      )}
    </div>
  );
}

/** One supplied distribution of a group, the parent pale and the kept incidents solid, read only, with the kept incidents it cannot place. */
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
      {distribution.unavailable.kept_case_count > 0 && <p className="groups-limit">{countOf(distribution.unavailable.kept_case_count, "incident")} {unavailable}</p>}
    </div>
  );
}
