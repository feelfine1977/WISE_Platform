import { describe, expect, it } from "vitest";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import type { ReadScoreRunRequest, ResolutionDefinition, ScoreRunAnswer } from "../generated/scoring";
import { identity, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { readyAnswer, runAnswer, scoringGraphAnswer, scoringPopulationAnswer, scoringSelectionAnswer, scoringRefusal, scriptedScoringClient, witnessAnswer } from "../test/scoring";
import { scriptedSelectionClient } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { type ScoringOutcome, scoringContract } from "./client";
import { ExpectationCoordinator, shownRun } from "./coordinator";
import { definitionOf, emptyForm } from "./definition";

interface ReadCall { request: ReadScoreRunRequest; signal: AbortSignal; reply: (value: ScoringOutcome<ScoreRunAnswer>) => void }
const authored = { ...emptyForm, name: "Response", owner: "Desk", sourceLabel: "Agreement", rationale: "Review", start: "Eröffnet", response: "Geschlossen", target: "4", width: "2", reviewed: true };
const definition = definitionOf(authored, "utc_instant", 1) as ResolutionDefinition;
async function settle() { await Promise.resolve(); await Promise.resolve(); }
async function setup() {
  const importing = scriptedImportClient(); const selecting = scriptedSelectionClient(); const scoring = scriptedScoringClient();
  const reads: ReadCall[] = [];
  const investigation = new ImportedInvestigationCoordinator(importing.client, selecting.client, scriptedViewClient().client);
  const client = { ...scoring.client, readRun: (request: ReadScoreRunRequest, signal: AbortSignal) => new Promise<ScoringOutcome<ScoreRunAnswer>>((reply) => reads.push({ request, signal, reply })) };
  const coordinator = new ExpectationCoordinator(client, investigation);
  coordinator.start();
  investigation.open({ workspaceId, preparationId });
  importing.populations[0].reply({ ok: true, answer: scoringPopulationAnswer(importing.populations[0].request) }); await settle();
  selecting.selections[0].reply({ ok: true, answer: scoringSelectionAnswer(selecting.selections[0].request) }); await settle();
  selecting.graphs[0].reply({ ok: true, answer: scoringGraphAnswer(selecting.graphs[0].request) }); await settle();
  return { ...scoring, reads, investigation, importing, selecting, coordinator };
}
async function scored() {
  const s = await setup(); s.coordinator.setForm(authored);
  s.coordinator.check({ workspaceId, baseIdentity: identity, population: { name: "Every incident", identity } }, definition);
  s.validations[0].reply({ ok: true, answer: readyAnswer(s.validations[0].request) }); await settle();
  s.coordinator.score(); const answer = runAnswer(s.scores[0].request, definition);
  s.scores[0].reply({ ok: true, answer }); await settle();
  const reference = s.coordinator.savedReference(); if (!reference) throw new Error("The shown run has a reference.");
  return { ...s, answer, reference };
}
function readAnswer(call: ReadCall, answer: ScoreRunAnswer): ScoreRunAnswer {
  return { ...answer, request_id: call.request.request_id, query_revision: call.request.query_revision, workspace_id: call.request.workspace_id };
}

describe("persistent expectation state and read-only saved runs", () => {
  it("reads a saved original run and its witness without another check or score", async () => {
    const s = await scored(); s.coordinator.restore(s.reference);
    expect(s.reads).toHaveLength(1); expect(scoringContract.readRunRequest(s.reads[0].request)).toBe(true);
    s.reads[0].reply({ ok: true, answer: readAnswer(s.reads[0], s.answer) }); await settle();
    expect(shownRun(s.coordinator.getState().run)).toEqual(s.answer.run);
    expect(s.coordinator.savedReference()).toEqual(s.reference); expect(s.coordinator.getState().form).toEqual(authored);
    s.coordinator.openCase("B-2");
    s.witnesses[0].reply({ ok: true, answer: witnessAnswer(s.witnesses[0].request, s.answer.run) }); await settle();
    expect(s.coordinator.getState().witness.phase).toBe("ready");
    expect([s.validations.length, s.scores.length, s.reads.length, s.witnesses.length]).toEqual([1, 1, 1, 1]);
  });

  it("retries a failed read as another read and refuses a changed saved calibration", async () => {
    const s = await scored(); s.coordinator.restore(s.reference);
    s.reads[0].reply({ ok: false, problem: { kind: "unreachable" } }); await settle();
    s.coordinator.retryScore(); expect(s.reads).toHaveLength(2);
    const wrong = readAnswer(s.reads[1], s.answer); wrong.run = { ...wrong.run, identity: { ...wrong.run.identity, calibration_id: `calibration.v1:sha256:${"e".repeat(64)}` } };
    s.reads[1].reply({ ok: true, answer: wrong }); await settle();
    expect(s.coordinator.getState().run.phase).toBe("failed");
    expect([s.validations.length, s.scores.length]).toEqual([1, 1]);
    expect(shownRun(s.coordinator.getState().run)).toEqual(s.answer.run);
  });

  it("resets reading-bound state and drops old read/validation/witness replies when preparation changes", async () => {
    const s = await scored(); s.coordinator.restore(s.reference); s.coordinator.openCase("B-2");
    s.investigation.open({ workspaceId, preparationId: `preparation.v1:sha256:${"e".repeat(64)}` });
    expect(s.reads[0].signal.aborted).toBe(true); expect(s.witnesses[0].signal.aborted).toBe(true);
    s.reads[0].reply({ ok: true, answer: readAnswer(s.reads[0], s.answer) });
    s.witnesses[0].reply({ ok: true, answer: witnessAnswer(s.witnesses[0].request, s.answer.run) }); await settle();
    expect(shownRun(s.coordinator.getState().run)).toEqual(s.answer.run);
    expect(s.coordinator.getState().witness.phase).toBe("closed");
    s.importing.populations[1].reply({ ok: true, answer: scoringPopulationAnswer(s.importing.populations[1].request) }); await settle();
    expect(shownRun(s.coordinator.getState().run)).toBeNull(); expect(s.coordinator.savedReference()).toBeNull();
    expect(s.coordinator.getState().form).toEqual(emptyForm);
  });

  it("defers saved reads until the exact reopened preparation is ready", async () => {
    const s = await scored(); s.investigation.open({ workspaceId, preparationId });
    s.coordinator.restore(s.reference); expect(s.reads).toHaveLength(0);
    s.importing.populations[1].reply({ ok: true, answer: scoringPopulationAnswer(s.importing.populations[1].request) }); await settle();
    expect(s.reads).toHaveLength(1);
    s.reads[0].reply({ ok: true, answer: readAnswer(s.reads[0], s.answer) }); await settle();
    expect(shownRun(s.coordinator.getState().run)).toEqual(s.answer.run);
    expect([s.validations.length, s.scores.length]).toEqual([1, 1]);
  });

  it("clears an explicitly absent saved reference without creating a definition or run", async () => {
    const s = await scored(); s.coordinator.restore(null);
    expect(shownRun(s.coordinator.getState().run)).toBeNull(); expect(s.coordinator.savedReference()).toBeNull();
    expect([s.validations.length, s.scores.length, s.reads.length]).toEqual([1, 1, 0]);
  });
});


describe("restored run binding and pending publication", () => {
  it.each(["score_run_id", "scored_population_id", "calibration_id"] as const)("refuses a reply differing from saved %s", async (field) => {
    const s = await scored();
    const prefixes = { score_run_id: "score-run", scored_population_id: "population", calibration_id: "calibration" };
    s.coordinator.restore({ ...s.reference, [field]: `${prefixes[field]}.v1:sha256:${"e".repeat(64)}` });
    s.reads[0].reply({ ok: true, answer: readAnswer(s.reads[0], s.answer) }); await settle();
    const state = s.coordinator.getState().run;
    expect(state.phase === "failed" && state.problem.kind).toBe("unsupported_reply");
    expect(shownRun(state)).toEqual(s.answer.run);
    expect([s.validations.length, s.scores.length]).toEqual([1, 1]);
  });

  it("rejects a saved run bound to another full preparation identity", async () => {
    const s = await scored(); s.coordinator.restore(s.reference);
    const answer = readAnswer(s.reads[0], s.answer);
    answer.run = { ...answer.run, identity: { ...answer.run.identity,
      base_identity: { ...answer.run.identity.base_identity, representation_id: `representation.v1:sha256:${"e".repeat(64)}` } } };
    s.reads[0].reply({ ok: true, answer }); await settle();
    const state = s.coordinator.getState().run;
    expect(state.phase === "failed" && state.problem.kind).toBe("unsupported_reply");
  });

  it("rejects a refusal that belongs to another workspace", async () => {
    const s = await scored(); s.coordinator.restore(s.reference);
    s.reads[0].reply(scoringRefusal({ ...s.reads[0].request, workspace_id: "workspace.v1:other-workspace" }, "read_score_run", "run_unavailable", "Not found.")); await settle();
    const state = s.coordinator.getState().run;
    expect(state.phase === "failed" && state.problem.kind).toBe("unsupported_reply");
  });

  it("aborts pending checks and explicit scores at a preparation change", async () => {
    const s = await setup();
    const target = { workspaceId, baseIdentity: identity, population: { name: "Every incident", identity } };
    s.coordinator.check(target, definition); s.validations[0].reply({ ok: true, answer: readyAnswer(s.validations[0].request) }); await settle();
    s.coordinator.score(); s.coordinator.check(target, definition);
    s.investigation.open({ workspaceId, preparationId: `preparation.v1:sha256:${"e".repeat(64)}` });
    expect(s.scores[0].signal.aborted).toBe(true); expect(s.validations[1].signal.aborted).toBe(true);
    s.scores[0].reply({ ok: true, answer: runAnswer(s.scores[0].request, definition) });
    s.validations[1].reply({ ok: true, answer: readyAnswer(s.validations[1].request) }); await settle();
    expect(s.coordinator.getState().validation.phase).toBe("idle"); expect(s.coordinator.getState().run.phase).toBe("idle");
  });

  it("discards an old-run witness when a different restored run answers", async () => {
    const s = await scored();
    const nextId = `score-run.v1:sha256:${"e".repeat(64)}`;
    s.coordinator.restore({ ...s.reference, score_run_id: nextId });
    s.coordinator.openCase("B-2");
    const answer = readAnswer(s.reads[0], s.answer);
    answer.run = { ...answer.run, identity: { ...answer.run.identity, run_id: nextId } };
    s.reads[0].reply({ ok: true, answer }); await settle();
    expect(s.witnesses[0].signal.aborted).toBe(true);
    s.witnesses[0].reply({ ok: true, answer: witnessAnswer(s.witnesses[0].request, s.answer.run) }); await settle();
    expect(shownRun(s.coordinator.getState().run)?.identity.run_id).toBe(nextId);
    expect(s.coordinator.getState().witness.phase).toBe("closed");
  });
});


it("waits for a restored replacement's new full reading before reading its saved run", async () => {
  const s = await scored();
  const newPrep = `preparation.v1:sha256:${"e".repeat(64)}`;
  const newBase = { ...identity, preparation_id: newPrep };
  const next = runAnswer({ ...s.scores[0].request, base_identity: newBase, named_population: { name: "New reading", identity: newBase } }, definition);
  next.run = { ...next.run, identity: { ...next.run.identity, run_id: `score-run.v1:sha256:${"e".repeat(64)}` } };
  const reference = { score_run_id: next.run.identity.run_id, scored_population_id: next.run.identity.scored_population_identity.population_id, calibration_id: next.run.identity.calibration_id };
  const saved = (await import("../test/saving")).savedContent;
  const binding = { investigationId: `investigation.v1:${"a".repeat(32)}`, revisionId: `saved-revision.v1:sha256:${"e".repeat(64)}`,
    content: { ...saved, base_identity: newBase, score_run_ref: reference } };
  s.investigation.restore({ target: { workspaceId, preparationId: newPrep }, steps: [], parentCaseIds: [...next.run.population.case_ids],
    selectionIdentity: { ...newBase, population_id: `population.v1:sha256:${"f".repeat(64)}` }, binding, view: "incidents" });
  s.coordinator.restore(reference);
  expect(s.reads).toHaveLength(0); expect(shownRun(s.coordinator.getState().run)).toEqual(s.answer.run);
  s.coordinator.check({ workspaceId, baseIdentity: identity, population: { name: "Old", identity } }, definition);
  s.coordinator.score(); s.coordinator.openCase("B-2");
  expect([s.validations.length, s.scores.length, s.witnesses.length]).toEqual([1, 1, 0]);
  s.importing.populations[1].reply({ ok: true, answer: scoringPopulationAnswer(s.importing.populations[1].request) }); await settle();
  expect(s.reads).toHaveLength(1);
  s.reads[0].reply({ ok: true, answer: readAnswer(s.reads[0], next) }); await settle();
  expect(shownRun(s.coordinator.getState().run)?.identity.base_identity).toEqual(newBase);
  expect(s.coordinator.savedReference()).toEqual(reference);
  expect([s.validations.length, s.scores.length]).toEqual([1, 1]);
});

it("retains the old run on a failed replacement and never reads the deferred new reference against it", async () => {
  const s = await scored();
  s.investigation.open({ workspaceId, preparationId: `preparation.v1:sha256:${"e".repeat(64)}` });
  s.coordinator.restore({ ...s.reference, score_run_id: `score-run.v1:sha256:${"e".repeat(64)}` });
  s.importing.populations[1].reply({ ok: false, problem: { kind: "unreachable" } }); await settle();
  expect(s.reads).toHaveLength(0); expect(shownRun(s.coordinator.getState().run)).toEqual(s.answer.run);
  expect(s.coordinator.getState().form).toEqual(authored);
});
