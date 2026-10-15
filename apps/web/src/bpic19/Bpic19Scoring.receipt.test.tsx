import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Bpic19Scoring } from "./Bpic19Scoring";
import { bpic19Contract, type Bpic19Client } from "./scoring-client";
import fixture from "./scoring-fixtures/native-two-items.json";

it("shows the exact stored analytical identities and fences them after a population change", async () => {
  const stored: unknown = structuredClone(fixture);
  if (!bpic19Contract.answer(stored)) throw new Error("The frozen native fixture must satisfy its contract");
  const definition = "definition-version.v1:sha256:" + "a".repeat(64);
  const parent = {...stored.base_identity, population_id: "population.v1:sha256:" + "9".repeat(64)};
  expect(parent.population_id).not.toBe(stored.named_population.identity.population_id);
  const run = {...stored, definition_id: definition, definition_version_id: definition, parent_identity: parent};
  const subject = {workspace_id: run.workspace_id, base_identity: run.base_identity,
    named_population: run.named_population, roles: {item_category: 3, resource: 5, net_worth: 7}};
  const client: Bpic19Client = {score: vi.fn(), read: vi.fn()};
  const {rerender} = render(<Bpic19Scoring subject={subject} initialRun={run} readOnly client={client} />);
  fireEvent.click(screen.getByText("Definition, source and run receipt", {exact: true}));
  expect(screen.getByText(`Native definition: ${definition}.`)).toBeTruthy();
  expect(screen.getByText(`Original source: ${run.base_identity.source_id}. Preparation: ${run.base_identity.preparation_id}.`)).toBeTruthy();
  expect(screen.getByText(`Assessed population: ${run.named_population.identity.population_id}. Frozen parent: ${run.parent_identity.population_id}.`)).toBeTruthy();
  rerender(<Bpic19Scoring subject={{...subject, named_population: {...subject.named_population,
    identity: {...subject.named_population.identity, population_id: "population.v1:sha256:" + "f".repeat(64)}}}} initialRun={run} readOnly client={client} />);
  await waitFor(() => expect(screen.queryByText(`Native definition: ${definition}.`)).toBeNull());
  expect(client.score).not.toHaveBeenCalled();
  expect(client.read).not.toHaveBeenCalled();
});

it("keeps absent legacy parent metadata explicit instead of using the current subject", () => {
  const stored: unknown = structuredClone(fixture);
  if (!bpic19Contract.answer(stored)) throw new Error("The native fixture must satisfy its contract");
  const {parent_identity: _parent, ...legacy} = stored;
  const subject = {workspace_id: legacy.workspace_id, base_identity: legacy.base_identity,
    named_population: legacy.named_population, roles: {item_category: 3, resource: 5, net_worth: 7}};
  render(<Bpic19Scoring subject={subject} initialRun={legacy} readOnly />);
  fireEvent.click(screen.getByText("Definition, source and run receipt", {exact: true}));
  expect(screen.getByText(`Assessed population: ${legacy.named_population.identity.population_id}. Frozen parent: Not retained in this legacy receipt.`)).toBeTruthy();
});

it("shows the stored selected-fit population, support and source policies without calling it a parent fit", () => {
  const stored: unknown = structuredClone(fixture);
  if (!bpic19Contract.answer(stored)) throw new Error("The native fixture must satisfy its contract");
  const roles = {item_category: 3, resource: 5, net_worth: 7};
  const review = {definition_id: "bpic19-measure-definition.v1:sha256:" + "5".repeat(64), identity: stored.named_population.identity,
    query: {policy_id: "bpic19.source_witnessed_measures.v1", measure_profile: "paper_v1", roles,
      offset: 0, limit: 1, value_reducer: "maximum_absolute_event_value", value_unit: "EUR", calibration_population: "selected"}};
  const run = {...stored, definition: {roles, exposure_review: review}, report: {...stored.report,
    settings: {...stored.report.settings, volume: "exposure"}, exposure_calibration: {
      policy: "max_absolute_p95", unit_provenance: "explicit_raw_measures_definition.v1",
      source_field: 7, source_column_name: "Original amount", source_unit: "EUR", value_reducer: "maximum_absolute_event_value",
      priority_unit: "normalized exposure-score units", cutoff: 19.5, population_case_ids: ["A", "B"],
      fit_population_identity: stored.named_population.identity, source_value_missing_policy: "unavailable",
      source_value_negative_policy: "absolute_before_max", calibration_id: "selected-fit-19.5", reviewed_measure_definition_id: review.definition_id}}};
  const subject = {workspace_id: stored.workspace_id, base_identity: stored.base_identity, named_population: stored.named_population, roles};
  render(<Bpic19Scoring subject={subject} initialRun={run} readOnly />);
  expect(screen.getByText(`Frozen reviewed fit population: ${stored.named_population.identity.population_id}. Complete items: 2.`)).toBeTruthy();
  expect(screen.getByText("Missing source amounts: unavailable. Negative source amounts: absolute_before_max.")).toBeTruthy();
  expect(screen.queryByText(/frozen parent 95th percentile/)).toBeNull();
});
