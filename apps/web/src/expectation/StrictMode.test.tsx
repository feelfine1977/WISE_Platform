import { StrictMode, useEffect, useState } from "react";
import { act, render } from "@testing-library/react";
import { expect, it } from "vitest";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { identity, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { readyAnswer, runAnswer, scoringGraphAnswer, scoringPopulationAnswer, scoringSelectionAnswer, scriptedScoringClient } from "../test/scoring";
import { scriptedSelectionClient } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { ExpectationCoordinator, shownRun } from "./coordinator";
import { definitionOf, emptyForm } from "./definition";

it("survives the App owner's StrictMode effect replay and still resets at a new committed preparation", async () => {
  const importing = scriptedImportClient(); const selecting = scriptedSelectionClient(); const scoring = scriptedScoringClient();
  const investigation = new ImportedInvestigationCoordinator(importing.client, selecting.client, scriptedViewClient().client);
  let current: ExpectationCoordinator | undefined;
  function Owner() {
    const [coordinator] = useState(() => new ExpectationCoordinator(scoring.client, investigation));
    current = coordinator;
    useEffect(() => { coordinator.start(); return () => coordinator.stop(); }, [coordinator]);
    return null;
  }
  const mounted = render(<StrictMode><Owner /></StrictMode>);
  if (!current) throw new Error("The surviving owner publishes its coordinator.");
  const coordinator = current;
  await act(async () => {
    investigation.open({ workspaceId, preparationId });
    importing.populations[0].reply({ ok: true, answer: scoringPopulationAnswer(importing.populations[0].request) });
  });
  await act(async () => selecting.selections[0].reply({ ok: true, answer: scoringSelectionAnswer(selecting.selections[0].request) }));
  await act(async () => selecting.graphs[0].reply({ ok: true, answer: scoringGraphAnswer(selecting.graphs[0].request) }));
  const form = { ...emptyForm, name: "Retained draft", owner: "Desk", sourceLabel: "Agreement", rationale: "Review", start: "Eröffnet", response: "Geschlossen", target: "4", width: "2", reviewed: true };
  const definition = definitionOf(form, "utc_instant", 1); if (!definition) throw new Error("The authored definition is valid.");
  await act(async () => { coordinator.setForm(form); coordinator.check({ workspaceId, baseIdentity: identity, population: { name: "All", identity } }, definition); });
  await act(async () => scoring.validations[0].reply({ ok: true, answer: readyAnswer(scoring.validations[0].request) }));
  await act(async () => coordinator.score());
  await act(async () => scoring.scores[0].reply({ ok: true, answer: runAnswer(scoring.scores[0].request, definition) }));
  expect(shownRun(coordinator.getState().run)).not.toBeNull();
  await act(async () => investigation.open({ workspaceId, preparationId: `preparation.v1:sha256:${"e".repeat(64)}` }));
  expect(shownRun(coordinator.getState().run)).not.toBeNull();
  await act(async () => importing.populations[1].reply({ ok: true, answer: scoringPopulationAnswer(importing.populations[1].request) }));
  expect(shownRun(coordinator.getState().run)).toBeNull();
  expect(coordinator.getState().form).toEqual(emptyForm);
  expect([scoring.validations.length, scoring.scores.length]).toEqual([1, 1]);
  mounted.unmount();
});
