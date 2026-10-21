import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import App from "./App";
import type { PreparationTarget } from "./imported/coordinator";
import type { ReadingMemory } from "./start/firstOpen";
import { healthy } from "./test/answers";
import {
  earlierPreparationId,
  exampleInspectionAnswer,
  importRefusal,
  interpretationAnswer,
  ownFolder,
  populationAnswer,
  preparationId,
  scriptedImportClient,
  sourceAnswer,
  workspaceAnswer,
  workspaceId,
} from "./test/imports";
import { scriptedSelectionClient } from "./test/selections";
import { scriptedViewClient } from "./test/views";

function renderApp(remembered: string | null = null, strict = false) {
  const imports = scriptedImportClient();
  const kept: PreparationTarget[] = [];
  const memory: ReadingMemory = {
    remember: (target) => void kept.push(target),
    recall: () => (remembered === null ? null : { preparationId: remembered, steps: [] }),
  };
  const user = userEvent.setup();
  const app = (
    <App
      importClient={imports.client}
      selectionClient={scriptedSelectionClient().client}
      viewClient={scriptedViewClient().client}
      checkHealth={healthy}
      readingMemory={memory}
    />
  );
  render(strict ? <StrictMode>{app}</StrictMode> : app);
  return { imports, kept, user };
}

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

function area(name: string): HTMLElement {
  return within(screen.getByRole("navigation", { name: "Areas" })).getByRole("button", { name });
}

function currentArea(): string | null {
  const areas = within(screen.getByRole("navigation", { name: "Areas" })).getAllByRole("button");
  return areas.find((button) => button.getAttribute("aria-current") === "page")?.textContent ?? null;
}

describe("the first use of the application", () => {
  it("opens its own workspace and the built-in sample without a question, and shows the process map of every incident first", async () => {
    const app = renderApp();
    expect(currentArea()).toBe("Investigations");
    expect(screen.getByText("Opening the application's workspace…")).toBeTruthy();
    expect(app.imports.workspaces).toHaveLength(0);

    const own = app.imports.ownWorkspaces[0];
    await deliver(() => own.reply({ ok: true, answer: workspaceAnswer(own.request) }));
    expect(screen.getByText(/Reading the built-in sample into the workspace\./)).toBeTruthy();

    const fetched = app.imports.examples[0];
    expect(fetched.request).toBe("S0");
    await deliver(() => fetched.reply({ ok: true, answer: new Blob(["incident_id\n"]) }));
    const upload = app.imports.uploads[0];
    await deliver(() => upload.reply({ ok: true, answer: sourceAnswer(upload.request, upload.file.size) }));
    const inspection = app.imports.inspections[0];
    await deliver(() => inspection.reply({ ok: true, answer: exampleInspectionAnswer(inspection.request) }));
    const confirmation = app.imports.confirmations[0];
    await deliver(() =>
      confirmation.reply({ ok: true, answer: interpretationAnswer({ ...confirmation.request, accept_report_issues: true }) }),
    );

    // The sample is opened as the reading it is, with no step: every incident of the reading is asked for.
    const population = app.imports.populations[0];
    expect(population.request.workspace_id).toBe(workspaceId);
    expect(population.request.preparation_id).toBe(preparationId);
    expect(app.kept).toEqual([{ workspaceId, preparationId, sourceName: "Synthetic example S0.csv" }]);
    await deliver(() => population.reply({ ok: true, answer: populationAnswer(population.request) }));

    expect(currentArea()).toBe("Investigations");
    const view = screen.getByRole("group", { name: "View" });
    expect(within(view).getAllByRole("button").map((button) => `${button.textContent}:${button.getAttribute("aria-pressed")}`)).toEqual([
      "Map:true",
      "Incidents:false",
      "Paths:false",
      "Matrix:false",
    ]);
    expect(screen.getByRole("heading", { name: "Map of the kept incidents" })).toBeTruthy();

    // Compare and Expectation work on these incidents; neither sends the analyst away.
    await app.user.click(area("Compare"));
    expect(screen.getByRole("heading", { name: "Compare" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Go to the Data area" })).toBeNull();
    await app.user.click(area("Expectation"));
    expect(screen.getByRole("heading", { name: "Expectation" })).toBeTruthy();
    expect(screen.queryByText(/None are open at the moment/)).toBeNull();

    // The Data area names the folder in use in one line and keeps another folder behind it.
    await app.user.click(area("Data"));
    const workspace = screen.getByRole("region", { name: "Workspace" });
    expect(workspace.textContent).toContain(ownFolder);
    expect(workspace.textContent).toContain("The application's own folder");
    // The other folder is the first disclosure; backing up and restoring stands behind its own.
    const [other, backup] = within(workspace).getAllByRole("group");
    expect(within(backup).getByText("Back up or restore")).toBeTruthy();
    expect(other.hasAttribute("open")).toBe(false);
    expect(within(other).getByText("Use another folder")).toBeTruthy();
    expect(screen.getByLabelText("Add an event-history CSV")).toBeTruthy();
  });

  it("opens the reading used last in the workspace instead of the sample", async () => {
    const app = renderApp(earlierPreparationId);
    const own = app.imports.ownWorkspaces[0];
    await deliver(() => own.reply({ ok: true, answer: workspaceAnswer(own.request, true) }));
    expect(app.imports.examples).toHaveLength(0);
    const population = app.imports.populations[0];
    expect(population.request.preparation_id).toBe(earlierPreparationId);
    await deliver(() => population.reply({ ok: true, answer: populationAnswer(population.request) }));
    expect(screen.getByRole("button", { name: "Map" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("says what stopped the start, offers to try again, and leads to the Data area where another folder can be chosen", async () => {
    const app = renderApp();
    const own = app.imports.ownWorkspaces[0];
    await deliver(() =>
      own.reply(importRefusal(own.request, "open_default_workspace", "workspace_not_writable", "The folder of the application cannot be written to.", "path")),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The application could not open its workspace");
    expect(alert.textContent).toContain("The folder of the application cannot be written to.");
    expect(app.imports.examples).toHaveLength(0);

    await app.user.click(screen.getByRole("button", { name: "Go to the Data area" }));
    expect(currentArea()).toBe("Data");
    expect(screen.getByRole("alert").textContent).toContain("The application's own folder cannot be used as a workspace");
    expect(screen.getByLabelText("Folder path")).toBeTruthy();

    await app.user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Try again" }));
    expect(app.imports.ownWorkspaces).toHaveLength(2);
    const again = app.imports.ownWorkspaces[1];
    await deliver(() => again.reply({ ok: true, answer: workspaceAnswer(again.request, true) }));
    expect(screen.getByRole("region", { name: "Workspace" }).textContent).toContain(ownFolder);
  });

  it("lets a folder chosen in the Data area replace the application's own, and offers the way back", async () => {
    const app = renderApp(earlierPreparationId);
    const own = app.imports.ownWorkspaces[0];
    await deliver(() => own.reply({ ok: true, answer: workspaceAnswer(own.request, true) }));
    await app.user.click(area("Data"));
    const workspace = screen.getByRole("region", { name: "Workspace" });
    await app.user.click(within(workspace).getByText("Use another folder"));
    await app.user.type(within(workspace).getByLabelText("Folder path"), "D:\\Investigations\\Incidents");
    await app.user.click(within(workspace).getByRole("button", { name: "Open workspace" }));
    const chosen = app.imports.workspaces[0];
    expect(chosen.request.path).toBe("D:\\Investigations\\Incidents");
    await deliver(() => chosen.reply({ ok: true, answer: workspaceAnswer(chosen.request) }));

    const line = screen.getByRole("region", { name: "Workspace" });
    expect(line.textContent).toContain("D:\\Investigations\\Incidents");
    expect(line.textContent).toContain("A folder you chose.");
    await app.user.click(within(line).getByText("Use another folder"));
    await app.user.click(within(line).getByRole("button", { name: "Use the application's own folder" }));
    expect(app.imports.ownWorkspaces).toHaveLength(2);
  });

  it("starts once under React's strict mode, which mounts the application twice", async () => {
    const app = renderApp(earlierPreparationId, true);
    expect(app.imports.ownWorkspaces).toHaveLength(2);
    expect(app.imports.ownWorkspaces[0].signal.aborted).toBe(true);
    const own = app.imports.ownWorkspaces[1];
    await deliver(() => own.reply({ ok: true, answer: workspaceAnswer(own.request, true) }));
    expect(app.imports.populations).toHaveLength(1);
    expect(app.imports.populations[0].request.preparation_id).toBe(earlierPreparationId);
  });
});
