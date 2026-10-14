import type { FlowGraph } from "wise-flow";
import type { SelectCasesRequest, SuppliedGraph } from "../generated/selection";
import type { ShownSelection } from "../imported/coordinator";
import { identity, workspaceId } from "../test/imports";
import { everyIncident, selectionAnswer, suppliedGraph } from "../test/selections";

/*
 * Graphs written for the tests of the map, its detail controls and its list of paths. They are
 * maps to draw, not counts of a log: the numbers follow the rules said at each graph and are not
 * worked out from incidents.
 */

const activityId = (index: number) => `activity.v1:sha256:${String(index).padStart(64, "0")}`;
const pathIdOf = (source: number, target: number) => `path.v1:sha256:${String(source * 100 + target).padStart(64, "0")}`;

/** Synthetic fixture rule: every passage of a path has its stated constant lag.
 * Only test data is constructed here; production consumers read supplied totals.
 */
function constantLagFixture(edges: SuppliedGraph["edges"]): Pick<SuppliedGraph, "edges" | "meta"> {
  const coordinates = edges.map((edge) => BigInt(edge.metrics.usableLagCount) * BigInt(edge.metrics.medianLagHours * 3_600_000_000));
  const total = coordinates.reduce((sum, value) => sum + value, 0n);
  const supplied = edges.map((edge, index) => ({ ...edge, metrics: { ...edge.metrics,
    totalLagHours: Number(coordinates[index]) / 3_600_000_000,
    totalLagMicroseconds: String(coordinates[index]),
    shareOfTotalLag: total === 0n ? null : Number(coordinates[index]) / Number(total),
  } }));
  const ranked = supplied.slice().sort((a, b) => {
    const left = BigInt(a.metrics.totalLagMicroseconds), right = BigInt(b.metrics.totalLagMicroseconds);
    if (left !== right) return left > right ? -1 : 1;
    return b.metrics.cases - a.metrics.cases || (a.payload.source_activity < b.payload.source_activity ? -1 : a.payload.source_activity > b.payload.source_activity ? 1 : a.payload.target_activity < b.payload.target_activity ? -1 : a.payload.target_activity > b.payload.target_activity ? 1 : 0);
  }).slice(0, 5);
  const top = ranked.reduce((sum, edge) => sum + BigInt(edge.metrics.totalLagMicroseconds), 0n);
  return { edges: supplied, meta: { ...suppliedGraph(["A-1", "B-2"]).meta, path_lag_totals: {
    total_hours: Number(total) / 3_600_000_000, total_microseconds: String(total),
    usable_passage_count: edges.reduce((sum, edge) => sum + edge.metrics.usableLagCount, 0), usable_path_count: edges.length,
    top_five_path_ids: ranked.map((edge) => edge.id) as SuppliedGraph["meta"]["path_lag_totals"]["top_five_path_ids"],
    top_five_total_hours: Number(top) / 3_600_000_000, top_five_total_microseconds: String(top), top_five_share: total === 0n ? null : Number(top) / Number(total),
  } } };
}

/** The name of the activity at a place of a graph below. */
export const stepName = (index: number) => `Schritt ${String(index).padStart(2, "0")}`;

/** How many activities the busy graph has. */
export const BUSY_ACTIVITIES = 12;

/**
 * A graph of twelve activities with more paths than a map can show at once, so that its detail
 * opens reduced: 42 paths, of which the map opens on the 18 with the most incidents.
 *
 * Activity i has 120 − 10·i incidents, but the sixth as many as the fifth: the two are a tie, which
 * the Activities slider takes in one step. The fourth has more records than incidents; it repeats.
 *
 * Paths, each with its incidents: the next activity (5 fewer than that activity has), the one
 * after the next (30 − 2·i), the one before (12 − i), the third from it (9 − i), and the fourth
 * activity to itself (15). Every third path counts one or two passages more than incidents. Each
 * path takes two hours longer than the one before it in this order.
 *
 * Incidents begin with the first three activities (100, 15, 5) and end with the last four
 * (5, 15, 30, 70 towards the last).
 */
export function busyGraph(): SuppliedGraph {
  const count = BUSY_ACTIVITIES;
  const incidents = (index: number) => 120 - 10 * (index === 5 ? 4 : index);
  const pairs: [number, number, number][] = [];
  for (let index = 0; index + 1 < count; index += 1) pairs.push([index, index + 1, incidents(index + 1) - 5]);
  for (let index = 0; index + 2 < count; index += 1) pairs.push([index, index + 2, 30 - 2 * index]);
  for (let index = 1; index < count; index += 1) pairs.push([index, index - 1, 12 - index]);
  for (let index = 0; index + 3 < count; index += 1) pairs.push([index, index + 3, 9 - index]);
  pairs.push([3, 3, 15]);
  const starts = [100, 15, 5];
  const ends = [5, 15, 30, 70];
  const whole = suppliedGraph(["A-1", "B-2"]);
  const witnesses = whole.edges[0].payload;
  const edges = pairs.map(([source, target, cases], place) => ({
    ...whole.edges[0],
    id: pathIdOf(source, target),
    source: activityId(source),
    target: activityId(target),
    metrics: { count: cases + (place % 3), cases, medianLagHours: 2 * (place + 1), usableLagCount: cases + (place % 3), shareOfTotalLag: null },
    payload: { ...witnesses, source_activity: stepName(source), target_activity: stepName(target) },
  }));
  const passagesInto = (index: number) => edges.filter((edge) => edge.target === activityId(index)).reduce((sum, edge) => sum + edge.metrics.count, 0);
  const passagesOutOf = (index: number) => edges.filter((edge) => edge.source === activityId(index)).reduce((sum, edge) => sum + edge.metrics.count, 0);
  return {
    ...whole,
    nodes: Array.from({ length: count }, (_, index) => ({
      id: activityId(index),
      kind: "activity" as const,
      label: stepName(index),
      metrics: {
        count: incidents(index) + (index === 3 ? 15 : 0),
        events: incidents(index) + (index === 3 ? 15 : 0),
        cases: incidents(index),
        starts: starts[index] ?? 0,
        ends: ends[index - (count - ends.length)] ?? 0,
        medianPreviousHours: 3,
        usablePreviousCount: passagesInto(index),
        medianNextHours: 4,
        usableNextCount: passagesOutOf(index),
      },
    })),
    ...constantLagFixture(edges),
  };
}

/** The node id of an activity of the busy graph, and the id of its path from one activity to another. */
export const busyIds = { activity: activityId, path: pathIdOf };

/**
 * A graph of so many activities, each followed by every other, that the map library draws it on
 * its Canvas once every path is shown: 50 activities and 2,450 paths. Activity i has 100 − i
 * incidents and its path to activity j has 60 − |i − j|.
 */
export function crowdedGraph(): SuppliedGraph {
  const count = 50;
  const whole = suppliedGraph(["A-1", "B-2"]);
  const edges = [];
  for (let source = 0; source < count; source += 1) {
    for (let target = 0; target < count; target += 1) {
      if (source === target) continue;
      const cases = 60 - Math.abs(source - target);
      edges.push({
        ...whole.edges[0],
        id: pathIdOf(source, target),
        source: activityId(source),
        target: activityId(target),
        metrics: { count: cases, cases, medianLagHours: 1, usableLagCount: cases, shareOfTotalLag: null },
        payload: { ...whole.edges[0].payload, source_activity: stepName(source), target_activity: stepName(target) },
      });
    }
  }
  return {
    ...whole,
    nodes: Array.from({ length: count }, (_, index) => ({
      id: activityId(index),
      kind: "activity" as const,
      label: stepName(index),
      metrics: { count: 100 - index, events: 100 - index, cases: 100 - index, starts: index === 0 ? 100 : 0, ends: index === count - 1 ? 51 : 0, medianPreviousHours: 1, usablePreviousCount: 1, medianNextHours: 1, usableNextCount: 1 },
    })),
    ...constantLagFixture(edges),
  };
}

const request: SelectCasesRequest = {
  schema_version: 1,
  message_type: "select_cases_request",
  request_id: "select-1",
  query_revision: 1,
  workspace_id: workspaceId,
  identity,
  parent_case_ids: null,
  predicates: [],
};

/** A graph as the selection with no step shows it: the map view is given it as the kept incidents and as the parent. */
export function shownWhole(graph: SuppliedGraph): ShownSelection {
  return { revision: 1, steps: [], answer: selectionAnswer(request, everyIncident), graph };
}

/**
 * A graph with stages, which the supplied graphs of the application do not have: two stages of two
 * activities each between a start and an end, as the map library reads them. Six cases begin; four
 * go on to the second stage.
 */
export function stagedGraph(): FlowGraph {
  const activity = (id: string, group: string, cases: number) => ({ id, kind: "activity" as const, label: id.toUpperCase(), group, metrics: { cases, events: cases } });
  const follows = (source: string, target: string, cases: number) => ({ id: `${source}-${target}`, kind: "follows" as const, source, target, metrics: { count: cases, cases } });
  return {
    nodes: [
      { id: "start", kind: "event", label: "Start", tags: ["start"], metrics: { cases: 6, count: 6 } },
      activity("a", "first", 6),
      activity("b", "first", 5),
      activity("c", "second", 4),
      activity("d", "second", 2),
      { id: "end", kind: "event", label: "End", tags: ["end"], metrics: { cases: 6, count: 6 } },
    ],
    edges: [
      { id: "start-a", kind: "flow", source: "start", target: "a", metrics: { count: 6, cases: 6 } },
      follows("a", "b", 5),
      follows("b", "c", 4),
      follows("a", "c", 1),
      follows("c", "d", 2),
      follows("d", "c", 1),
      { id: "b-end", kind: "flow", source: "b", target: "end", metrics: { count: 1, cases: 1 } },
      { id: "c-end", kind: "flow", source: "c", target: "end", metrics: { count: 3, cases: 3 } },
      { id: "d-end", kind: "flow", source: "d", target: "end", metrics: { count: 2, cases: 2 } },
    ],
    groups: [
      { id: "first", kind: "stage", label: "First stage" },
      { id: "second", kind: "stage", label: "Second stage" },
    ],
  };
}
