import { afterEach, describe, expect, it, vi } from "vitest";
import type { UploadSourceMetadata } from "../generated/imports";
import { caseSummaries, evidenceAnswer, importRefusal, inspectionAnswer, populationAnswer, workspaceId } from "../test/imports";
import { exampleSourceRoute, httpImportClient, importContract, routes, uploadQuery } from "./client";

const populationRequest = {
  schema_version: 1,
  message_type: "open_population_request",
  request_id: "population-1",
  query_revision: 1,
  workspace_id: workspaceId,
  preparation_id: `preparation.v1:sha256:${"6".repeat(64)}`,
} as const;

const metadata: UploadSourceMetadata = {
  schema_version: 1,
  message_type: "upload_source_metadata",
  request_id: "source-2",
  query_revision: 2,
  workspace_id: workspaceId,
  filename: "Vorgänge März & April.csv",
};

function replying(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_route: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the import contract checks", () => {
  it("accept a population of 40,000 incidents and refuse one that names an incident twice", () => {
    const large = populationAnswer(populationRequest, caseSummaries(40000));
    const started = performance.now();
    expect(importContract.populationAnswer(large)).toBe(true);
    // A pairwise comparison of 40,000 ids takes seconds; one pass takes milliseconds.
    expect(performance.now() - started).toBeLessThan(1500);

    const twice = populationAnswer(populationRequest, caseSummaries(3));
    twice.population.case_ids = ["INC-00000", "INC-00001", "INC-00000"];
    expect(importContract.populationAnswer(twice)).toBe(false);
  });

  it("refuse repeated row ids, roles and context columns wherever the contract asks for unique items", () => {
    const evidence = evidenceAnswer({
      schema_version: 1,
      message_type: "imported_case_evidence_request",
      request_id: "case-1",
      query_revision: 1,
      workspace_id: workspaceId,
      identity: populationAnswer(populationRequest).identity,
      case_id: "A-1",
    });
    expect(importContract.caseEvidenceAnswer(evidence)).toBe(true);
    expect(importContract.caseEvidenceAnswer({ ...evidence, mapped_row_ids: [evidence.mapped_row_ids[0], evidence.mapped_row_ids[0]] })).toBe(false);

    const inspection = inspectionAnswer({
      schema_version: 1,
      message_type: "inspect_csv_request",
      request_id: "inspect-1",
      query_revision: 1,
      workspace_id: workspaceId,
      source_id: `source.v1:sha256:${"5".repeat(64)}`,
    });
    expect(importContract.inspectionAnswer(inspection)).toBe(true);
    inspection.role_suggestions[0].roles = ["context", "context"];
    expect(importContract.inspectionAnswer(inspection)).toBe(false);

    const population = populationAnswer(populationRequest);
    population.preparation.mapping.context_columns = [3, 3];
    expect(importContract.populationAnswer(population)).toBe(false);
  });
});

describe("the import client", () => {
  it("sends a source's bytes unchanged as the body of one request, with the metadata in the query", async () => {
    const fetchMock = replying(200, {
      schema_version: 1,
      message_type: "source_answer",
      request_id: "source-2",
      query_revision: 2,
      workspace_id: workspaceId,
      source: { source_id: `source.v1:sha256:${"5".repeat(64)}`, filename: metadata.filename, byte_count: 3 },
    });
    const file = new File([new Uint8Array([0xe4, 0x3b, 0x0a])], metadata.filename);

    const outcome = await httpImportClient.uploadSource(metadata, file, new AbortController().signal);

    expect(outcome.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(file);
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/octet-stream");
    const [route, query] = url.split("?");
    expect(route).toBe(routes.sources);
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
      schema_version: "1",
      message_type: "upload_source_metadata",
      request_id: "source-2",
      query_revision: "2",
      workspace_id: workspaceId,
      filename: "Vorgänge März & April.csv",
    });
    expect(uploadQuery(metadata)).toBe(query);
  });

  it("returns a refusal of the operation as a refusal, whatever its status", async () => {
    const refusal = importRefusal(metadata, "upload_source", "workspace_not_writable", "The workspace cannot be written.");
    if (refusal.ok || refusal.problem.kind !== "refusal") throw new Error("A refusal was expected.");
    replying(403, refusal.problem.refusal);

    const outcome = await httpImportClient.uploadSource(metadata, new Blob([]), new AbortController().signal);

    expect(outcome).toEqual(refusal);
  });

  it("reports a missing operation, an unreadable reply and no connection as failures, never as answers", async () => {
    replying(404, { detail: "API route not found" });
    expect(await httpImportClient.openPopulation(populationRequest, new AbortController().signal)).toEqual({
      ok: false,
      problem: { kind: "http", status: 404 },
    });

    replying(200, { ...populationAnswer(populationRequest), cases: "all" });
    const unreadable = await httpImportClient.openPopulation(populationRequest, new AbortController().signal);
    expect(unreadable.ok === false && unreadable.problem.kind).toBe("unsupported_reply");

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await httpImportClient.openPopulation(populationRequest, new AbortController().signal)).toEqual({
      ok: false,
      problem: { kind: "unreachable" },
    });
  });
});

describe("the cutoff proposal and the example bytes", () => {
  const proposal = {
    schema_version: 1,
    message_type: "cutoff_proposal_answer",
    request_id: "proposal-3",
    query_revision: 3,
    workspace_id: workspaceId,
    source_id: `source.v1:sha256:${"5".repeat(64)}`,
    timestamp_kind: "utc_instant",
    last_usable_time: "2026-04-14T07:30:20Z",
    proposed_cutoff: "2026-04-14T07:31:00Z",
  };

  it("accept a proposal on one clock and refuse one that mixes clocks, adds or drops a field, proposes without a latest time or writes an instant otherwise", () => {
    expect(importContract.cutoffProposalAnswer(proposal)).toBe(true);
    expect(importContract.cutoffProposalAnswer({ ...proposal, last_usable_time: null, proposed_cutoff: null })).toBe(true);
    expect(importContract.cutoffProposalAnswer({ ...proposal, timestamp_kind: "wall_clock", last_usable_time: "2026-04-14T07:30:20.500000", proposed_cutoff: "2026-04-14T07:31:00" })).toBe(true);
    expect(importContract.cutoffProposalAnswer({ ...proposal, timestamp_kind: "wall_clock" })).toBe(false);
    // A latest time in the last minute of the year 9999 cannot be rounded up; a proposal without one cannot be.
    expect(importContract.cutoffProposalAnswer({ ...proposal, last_usable_time: "9999-12-31T23:59:30Z", proposed_cutoff: null })).toBe(true);
    expect(importContract.cutoffProposalAnswer({ ...proposal, last_usable_time: null })).toBe(false);
    expect(importContract.cutoffProposalAnswer({ ...proposal, note: "extra" })).toBe(false);
    expect(importContract.cutoffProposalAnswer({ ...proposal, query_revision: "3" })).toBe(false);
    // An instant is written in UTC with a Z and at most six decimals of a second; the source stays named.
    expect(importContract.cutoffProposalAnswer({ ...proposal, last_usable_time: "2026-04-14T07:30:20.1234567Z" })).toBe(false);
    expect(importContract.cutoffProposalAnswer({ ...proposal, proposed_cutoff: "2026-04-14T09:31:00+02:00" })).toBe(false);
    const { source_id: _source, ...unbound } = proposal;
    expect(importContract.cutoffProposalAnswer(unbound)).toBe(false);
  });

  it("fetch an example's bytes from its route and report a missing example as an HTTP failure", async () => {
    const fetchMock = vi.fn(async (_route: string, _init: RequestInit) => new Response("incident_id\r\n", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await httpImportClient.exampleSource("S2", new AbortController().signal);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/examples/S2/source");
    expect(exampleSourceRoute("S2")).toBe("/api/examples/S2/source");
    expect(outcome.ok && (await outcome.answer.text())).toBe("incident_id\r\n");

    replying(404, { detail: "The application ships no example of this name." });
    expect(await httpImportClient.exampleSource("S2", new AbortController().signal)).toEqual({ ok: false, problem: { kind: "http", status: 404 } });
  });

  it("post the proposal request to its route and pass on the refusal of a confirmation", async () => {
    const fetchMock = replying(200, proposal);
    const request = { request_id: "proposal-3", query_revision: 3, workspace_id: workspaceId } as never;
    expect(await httpImportClient.proposeCutoff(request, new AbortController().signal)).toEqual({ ok: true, answer: proposal });
    expect(fetchMock.mock.calls[0][0]).toBe(routes.cutoffProposal);

    const refusal = importRefusal(proposal, "confirm_mapping", "timezone_required", "A timestamp without a zone needs an explicit zone.");
    replying(422, refusal.ok ? null : refusal.problem.kind === "refusal" ? refusal.problem.refusal : null);
    expect(await httpImportClient.proposeCutoff(request, new AbortController().signal)).toEqual(refusal);
  });
});
