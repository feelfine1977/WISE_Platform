import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { scriptedImportClient } from "../test/imports";
import { scriptedSelectionClient } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { describe, expect, it } from "vitest";
import type { NamedPopulation, ResolutionDefinition } from "../generated/scoring";
import { identity, workspaceId } from "../test/imports";
import { readyAnswer, runAnswer, scoringRefusal, scriptedScoringClient, witnessAnswer } from "../test/scoring";
import { scoringContract } from "./client";
import { ExpectationCoordinator, type ScoringTarget, shownRun } from "./coordinator";
import { definitionOf, emptyForm } from "./definition";

const form = { ...emptyForm, name: "Closed within four hours", owner: "Service desk", sourceLabel: "Agreement 7", rationale: "Customers wait.", start: "Eröffnet", response: "Geschlossen", target: "4", width: "2" };
const reviewed = definitionOf({ ...form, reviewed: true }, "utc_instant", 1) as ResolutionDefinition;
const draft = definitionOf(form, "utc_instant", 1) as ResolutionDefinition;
const population: NamedPopulation = { name: "every incident of Vorgänge.csv", identity };
const target: ScoringTarget = { workspaceId, baseIdentity: identity, population };

function setUp() {
  const scripted = scriptedScoringClient();
  const coordinator = new ExpectationCoordinator(scripted.client, new ImportedInvestigationCoordinator(scriptedImportClient().client, scriptedSelectionClient().client, scriptedViewClient().client));
  coordinator.start();
  return { ...scripted, coordinator };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("the expectation coordinator", () => {
  it("checks a definition with a request of the contract and drops the reply to an earlier check", async () => {
    const { coordinator, validations } = setUp();
    coordinator.check(target, draft);
    coordinator.check(target, reviewed);
    expect(validations.map((call) => scoringContract.validateRequest(call.request))).toEqual([true, true]);
    expect(validations[0].signal.aborted).toBe(true);
    validations[0].reply({ ok: true, answer: readyAnswer(validations[0].request) });
    await settle();
    expect(coordinator.getState().validation.phase).toBe("loading");
    validations[1].reply({ ok: true, answer: readyAnswer(validations[1].request) });
    await settle();
    const validation = coordinator.getState().validation;
    expect(validation.phase === "ready" && validation.answer.definition_version?.definition.review_state).toBe("reviewed");
  });

  it("scores only a ready, reviewed version, for the incidents it was checked for", async () => {
    const { coordinator, validations, scores } = setUp();
    coordinator.check(target, draft);
    validations[0].reply({ ok: true, answer: readyAnswer(validations[0].request) });
    await settle();
    coordinator.score();
    expect(scores).toHaveLength(0);
    coordinator.check(target, reviewed);
    validations[1].reply({ ok: true, answer: readyAnswer(validations[1].request) });
    await settle();
    coordinator.score();
    expect(scores).toHaveLength(1);
    const request = scores[0].request;
    expect(scoringContract.scoreRequest(request)).toBe(true);
    expect(request.named_population).toEqual(population);
    scores[0].reply({ ok: true, answer: runAnswer(request, reviewed) });
    await settle();
    expect(shownRun(coordinator.getState().run)?.cases).toHaveLength(5);
  });

  it("refuses a run of other incidents and keeps the run shown when a score fails", async () => {
    const { coordinator, validations, scores } = setUp();
    coordinator.check(target, reviewed);
    validations[0].reply({ ok: true, answer: readyAnswer(validations[0].request) });
    await settle();
    coordinator.score();
    scores[0].reply({ ok: true, answer: runAnswer(scores[0].request, reviewed) });
    await settle();
    const first = shownRun(coordinator.getState().run);
    coordinator.score();
    const other = runAnswer({ ...scores[1].request, named_population: { ...population, identity: { ...identity, population_id: `population.v1:sha256:${"c".repeat(64)}` } } }, reviewed);
    scores[1].reply({ ok: true, answer: { ...other, request_id: scores[1].request.request_id } });
    await settle();
    const run = coordinator.getState().run;
    expect(run.phase).toBe("failed");
    expect(run.phase === "failed" && run.problem).toEqual({ kind: "unsupported_reply", detail: "The reply scored different incidents." });
    expect(shownRun(run)).toBe(first);
  });

  it("keeps a check during a pending score from leaving the score pending", async () => {
    const { coordinator, validations, scores } = setUp();
    coordinator.check(target, reviewed);
    validations[0].reply({ ok: true, answer: readyAnswer(validations[0].request) });
    await settle();
    coordinator.score();
    coordinator.check(target, reviewed);
    scores[0].reply({ ok: true, answer: runAnswer(scores[0].request, reviewed) });
    await settle();
    expect(coordinator.getState().run.phase).toBe("ready");
    expect(coordinator.getState().validation.phase).toBe("loading");
  });

  it("lists a state's incidents as a view without asking the local service", async () => {
    const { coordinator, validations, scores, witnesses } = setUp();
    coordinator.choose("partly");
    expect(coordinator.getState().chosen).toBeNull();
    coordinator.check(target, reviewed);
    validations[0].reply({ ok: true, answer: readyAnswer(validations[0].request) });
    await settle();
    coordinator.score();
    scores[0].reply({ ok: true, answer: runAnswer(scores[0].request, reviewed) });
    await settle();
    coordinator.choose("partly");
    expect(coordinator.getState().chosen).toBe("partly");
    coordinator.clearChoice();
    expect(coordinator.getState().chosen).toBeNull();
    expect([validations.length, scores.length, witnesses.length]).toEqual([1, 1, 0]);
  });

  it("opens the records of a scored incident and drops the reply for an incident opened earlier", async () => {
    const { coordinator, validations, scores, witnesses } = setUp();
    coordinator.check(target, reviewed);
    validations[0].reply({ ok: true, answer: readyAnswer(validations[0].request) });
    await settle();
    coordinator.score();
    scores[0].reply({ ok: true, answer: runAnswer(scores[0].request, reviewed) });
    await settle();
    const run = shownRun(coordinator.getState().run)!;
    coordinator.openCase("D-4");
    coordinator.openCase("B-2");
    expect(witnesses.map((call) => scoringContract.witnessRequest(call.request))).toEqual([true, true]);
    witnesses[0].reply({ ok: true, answer: witnessAnswer(witnesses[0].request, run) });
    await settle();
    expect(coordinator.getState().witness).toEqual({ phase: "loading", caseId: "B-2" });
    witnesses[1].reply({ ok: true, answer: witnessAnswer(witnesses[1].request, run) });
    await settle();
    const witness = coordinator.getState().witness;
    expect(witness.phase === "ready" && witness.answer.response_candidate_row_ids).toHaveLength(2);
  });

  it("shows a refusal of the current check and drops one that names an older request", async () => {
    const { coordinator, validations } = setUp();
    coordinator.check(target, reviewed);
    validations[0].reply(scoringRefusal({ ...validations[0].request, request_id: "validate-0" }, "validate_expectation", "method_unavailable", "Not installed."));
    await settle();
    const stale = coordinator.getState().validation;
    expect(stale.phase === "failed" && stale.problem.kind).toBe("unsupported_reply");
    coordinator.retryCheck();
    validations[1].reply(scoringRefusal(validations[1].request, "validate_expectation", "unevaluable_sequence", "Order unknown.", ["B-2"]));
    await settle();
    const refused = coordinator.getState().validation;
    expect(refused.phase === "failed" && refused.problem.kind === "refusal" && refused.problem.refusal.case_ids).toEqual(["B-2"]);
  });
});
