import { describe, expect, it } from "vitest";
import { importContract } from "../data/client";
import { DataCoordinator } from "../data/coordinator";
import type { WorkspaceAnswer } from "../generated/imports";
import type { PreparationTarget } from "../imported/coordinator";
import {
  earlierPreparationId,
  exampleInspectionAnswer,
  interpretationAnswer,
  otherSourceId,
  preparationId,
  scriptedImportClient,
  sourceAnswer,
  workspaceAnswer,
  workspaceId,
} from "../test/imports";
import { FirstOpen, type ReadingMemory, startExample } from "./firstOpen";

/** Lets the replies delivered so far reach the coordinators. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(remembered: string | null = null) {
  const imports = scriptedImportClient();
  const data = new DataCoordinator(imports.client);
  const opened: PreparationTarget[] = [];
  const memory: ReadingMemory = { remember: () => undefined, recall: (id) => (id === workspaceId ? remembered : null) };
  const start = new FirstOpen(data, (target) => opened.push(target), memory);
  return { imports, data, opened, start };
}

type Setup = ReturnType<typeof setup>;

/** The application's own workspace with two readings of one earlier source. */
function withTwoReadings(answer: WorkspaceAnswer): WorkspaceAnswer {
  return {
    ...answer,
    preparations: [
      { preparation_id: earlierPreparationId, source_id: otherSourceId },
      { preparation_id: preparationId, source_id: otherSourceId },
    ],
  };
}

async function openOwnWorkspace({ imports }: Setup, change: (answer: WorkspaceAnswer) => WorkspaceAnswer = (answer) => answer, earlier = false) {
  const call = imports.ownWorkspaces.at(-1)!;
  call.reply({ ok: true, answer: change(workspaceAnswer(call.request, earlier)) });
  await settle();
}

/** Delivers the replies of the example's way through the ordinary pipeline, up to its reading. */
async function readExample({ imports }: Setup) {
  const fetched = imports.examples.at(-1)!;
  fetched.reply({ ok: true, answer: new Blob(["incident_id\n"]) });
  await settle();
  const upload = imports.uploads.at(-1)!;
  upload.reply({ ok: true, answer: sourceAnswer(upload.request, upload.file.size) });
  await settle();
  const inspection = imports.inspections.at(-1)!;
  inspection.reply({ ok: true, answer: exampleInspectionAnswer(inspection.request) });
  await settle();
  return { fetched, upload, confirmation: imports.confirmations.at(-1)! };
}

describe("the start of the application", () => {
  it("opens the application's own workspace and, when it holds no reading, reads the packaged example like any source and opens it", async () => {
    const app = setup();
    expect(app.start.getState()).toEqual({ phase: "idle" });
    app.start.start();
    expect(app.start.getState()).toEqual({ phase: "workspace" });
    expect(app.imports.workspaces).toHaveLength(0);
    expect(importContract.openDefaultWorkspaceRequest(app.imports.ownWorkspaces[0].request)).toBe(true);

    await openOwnWorkspace(app);
    expect(app.start.getState()).toEqual({ phase: "example" });
    const { fetched, upload, confirmation } = await readExample(app);
    expect(fetched.request).toBe("S0");
    expect(upload.request.filename).toBe(startExample.filename);
    expect(upload.request.workspace_id).toBe(workspaceId);
    expect(importContract.confirmMappingRequest(confirmation.request)).toBe(true);
    // The example asks for no acceptance of rows with issues on the analyst's behalf.
    expect(confirmation.request.accept_report_issues).toBe(false);
    expect(app.opened).toEqual([]);

    confirmation.reply({ ok: true, answer: interpretationAnswer({ ...confirmation.request, accept_report_issues: true }) });
    await settle();
    expect(app.opened).toEqual([{ workspaceId, preparationId, sourceName: startExample.filename }]);
    expect(app.start.getState()).toEqual({ phase: "done" });
  });

  it("opens the reading remembered for this workspace when the workspace lists it", async () => {
    const app = setup(earlierPreparationId);
    app.start.start();
    await openOwnWorkspace(app, withTwoReadings, true);
    expect(app.opened).toEqual([{ workspaceId, preparationId: earlierPreparationId, sourceName: "Ältere Vorgänge.csv" }]);
    expect(app.start.getState()).toEqual({ phase: "done" });
    expect(app.imports.examples).toHaveLength(0);
  });

  it("opens the reading listed last when nothing is remembered, or when what is remembered is not in the workspace", async () => {
    for (const remembered of [null, `preparation.v1:sha256:${"0".repeat(64)}`]) {
      const app = setup(remembered);
      app.start.start();
      await openOwnWorkspace(app, withTwoReadings, true);
      expect(app.opened).toEqual([{ workspaceId, preparationId, sourceName: "Ältere Vorgänge.csv" }]);
    }
  });

  it("says that the workspace could not be opened and sends the request again on a retry", async () => {
    const app = setup();
    app.start.start();
    app.imports.ownWorkspaces[0].reply({ ok: false, problem: { kind: "unreachable" } });
    await settle();
    expect(app.start.getState()).toEqual({ phase: "failed", step: "workspace", problem: { kind: "unreachable" } });
    expect(app.opened).toEqual([]);

    app.start.retry();
    expect(app.start.getState()).toEqual({ phase: "workspace" });
    expect(app.imports.ownWorkspaces).toHaveLength(2);
    await openOwnWorkspace(app, (answer) => answer, true);
    expect(app.opened).toEqual([{ workspaceId, preparationId: earlierPreparationId, sourceName: "Ältere Vorgänge.csv" }]);
  });

  it("says that the example could not be read and reads it again on a retry", async () => {
    const app = setup();
    app.start.start();
    await openOwnWorkspace(app);
    app.imports.examples[0].reply({ ok: false, problem: { kind: "http", status: 500 } });
    await settle();
    expect(app.start.getState()).toEqual({ phase: "failed", step: "example", problem: { kind: "http", status: 500 } });

    app.start.retry();
    expect(app.start.getState()).toEqual({ phase: "example" });
    const { confirmation } = await readExample(app);
    confirmation.reply({ ok: true, answer: interpretationAnswer({ ...confirmation.request, accept_report_issues: true }) });
    await settle();
    expect(app.opened).toEqual([{ workspaceId, preparationId, sourceName: startExample.filename }]);
  });

  it("leaves an example that waits for a confirmation to the analyst", async () => {
    const app = setup();
    app.start.start();
    await openOwnWorkspace(app);
    const { confirmation } = await readExample(app);
    confirmation.reply({ ok: true, answer: interpretationAnswer(confirmation.request) });
    await settle();
    expect(app.start.getState()).toEqual({ phase: "failed", step: "example", problem: null });
    expect(app.opened).toEqual([]);
  });

  it("steps aside for good when the analyst chooses a folder while the application's own is opening", async () => {
    const app = setup();
    app.start.start();
    app.data.openWorkspace("D:\\Investigations\\Incidents");
    expect(app.start.getState()).toEqual({ phase: "done" });
    const chosen = app.imports.workspaces[0];
    chosen.reply({ ok: true, answer: workspaceAnswer(chosen.request, true) });
    await openOwnWorkspace(app, (answer) => answer, true);
    expect(app.opened).toEqual([]);
    expect(app.imports.examples).toHaveLength(0);
    expect(app.data.getState().workspace).toMatchObject({ phase: "open", own: false });
  });

  it("steps aside when the analyst adds a source while the example is being read", async () => {
    const app = setup();
    app.start.start();
    await openOwnWorkspace(app);
    app.data.addSource(new File(["a;b\n"], "Vorgänge.csv"));
    expect(app.start.getState()).toEqual({ phase: "done" });
    expect(app.opened).toEqual([]);
  });

  it("sends the request for its workspace again when it was stopped before the reply and started anew", async () => {
    const app = setup();
    app.start.start();
    app.start.stop();
    app.data.stop();
    app.start.start();
    expect(app.imports.ownWorkspaces).toHaveLength(2);
    expect(app.imports.ownWorkspaces[0].signal.aborted).toBe(true);
    await openOwnWorkspace(app, (answer) => answer, true);
    expect(app.opened).toEqual([{ workspaceId, preparationId: earlierPreparationId, sourceName: "Ältere Vorgänge.csv" }]);
  });

  it("does nothing when a workspace is already chosen at its start", async () => {
    const app = setup();
    app.data.openWorkspace("D:\\Investigations\\Incidents");
    app.start.start();
    expect(app.start.getState()).toEqual({ phase: "done" });
    expect(app.imports.ownWorkspaces).toHaveLength(0);
  });
});
