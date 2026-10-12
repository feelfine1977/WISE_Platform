import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../App";
import { healthy, scriptedClient } from "../test/answers";
import {
  commaInspectionAnswer,
  importRefusal,
  inspectionAnswer,
  interpretationAnswer,
  populationAnswer,
  scriptedImportClient,
  sourceAnswer,
  workspaceAnswer,
} from "../test/imports";
import { importContract } from "./client";

const FOLDER = "C:\\Users\\Analyst\\Investigations";
// Windows-1252 bytes of a semicolon source; the screen never reads them, it hands the file on.
const BYTES = new Uint8Array([0x56, 0x6f, 0x72, 0x67, 0xe4, 0x6e, 0x67, 0x65, 0x3b, 0x0d, 0x0a]);

function renderApp() {
  const examples = scriptedClient();
  const imports = scriptedImportClient();
  const user = userEvent.setup();
  render(<App client={examples.client} importClient={imports.client} checkHealth={healthy} />);
  return { imports, user };
}

type Screen = ReturnType<typeof renderApp>;

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

async function openWorkspace(app: Screen, earlier = false) {
  await app.user.click(screen.getByRole("button", { name: "Data" }));
  await app.user.clear(screen.getByLabelText("Folder path"));
  await app.user.type(screen.getByLabelText("Folder path"), FOLDER);
  await app.user.click(screen.getByRole("button", { name: "Open workspace" }));
  const call = app.imports.workspaces.at(-1)!;
  await deliver(() => call.reply({ ok: true, answer: workspaceAnswer(call.request, earlier) }));
}

async function addSource(app: Screen) {
  const file = new File([BYTES], "Vorgänge.csv", { type: "text/csv" });
  await app.user.upload(screen.getByLabelText("Add an event-history CSV"), file);
  const upload = app.imports.uploads.at(-1)!;
  await deliver(() => upload.reply({ ok: true, answer: sourceAnswer(upload.request, file.size) }));
  const inspection = app.imports.inspections.at(-1)!;
  await deliver(() => inspection.reply({ ok: true, answer: inspectionAnswer(inspection.request) }));
  return { file, upload, inspection };
}

/** Chooses the roles, the day-first format, UTC+02:00 and the cutoff for the hand-made source. */
async function chooseReading(app: Screen, format = "Day first with dots") {
  await app.user.selectOptions(screen.getByLabelText("Incident id"), "0");
  await app.user.selectOptions(screen.getByLabelText("Activity"), "1");
  await app.user.selectOptions(screen.getByLabelText("Time"), "2");
  await app.user.click(screen.getByLabelText("Gruppe — 3 filled cells, 3 distinct values"));
  await app.user.click(screen.getByLabelText(new RegExp(format)));
  await app.user.click(screen.getByLabelText("One fixed offset for every time"));
  await app.user.selectOptions(screen.getByLabelText("Offset from UTC"), "120");
  fireEvent.change(screen.getByLabelText("Export taken at (UTC)"), { target: { value: "2027-01-01T00:00:00" } });
}

function figure(label: string): string {
  const term = screen.getByText(label, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? "";
}

describe("the Data area", () => {
  it("shows a refused folder with what to do, then offers what an earlier run stored", async () => {
    const app = renderApp();
    await app.user.click(screen.getByRole("button", { name: "Data" }));
    await app.user.type(screen.getByLabelText("Folder path"), "C:\\Users\\Analyst\\Documents");
    await app.user.click(screen.getByRole("button", { name: "Open workspace" }));
    const refused = app.imports.workspaces[0];
    expect(importContract.openWorkspaceRequest(refused.request)).toBe(true);
    expect(refused.request.path).toBe("C:\\Users\\Analyst\\Documents");
    await deliver(() =>
      refused.reply(
        importRefusal(
          refused.request,
          "open_workspace",
          "workspace_incompatible",
          "This folder already holds other files and is not a workspace.",
          "path",
        ),
      ),
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("This folder cannot be used as a workspace");
    expect(alert.textContent).toContain("This folder already holds other files and is not a workspace.");
    expect(alert.textContent).toContain("What to do Choose an empty folder for a new workspace, or a folder that already is a workspace.");
    expect(within(alert).queryByRole("button", { name: "Try again" })).toBeNull();

    await openWorkspace(app, true);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(FOLDER)).toBeTruthy();
    const sources = screen.getByRole("table", { name: "Sources in this workspace" });
    expect(within(sources).getByRole("rowheader").textContent).toBe("Ältere Vorgänge.csv");
    expect(within(sources).getByText("2.0 KB")).toBeTruthy();
    const preparations = screen.getByRole("table", { name: "Prepared readings in this workspace" });
    expect(within(preparations).getByRole("rowheader").textContent).toBe("Ältere Vorgänge.csv");

    await app.user.click(within(preparations).getByRole("button", { name: /^Open incidents of Ältere Vorgänge\.csv/ }));
    const population = app.imports.populations[0];
    expect(importContract.openPopulationRequest(population.request)).toBe(true);
    expect(population.request.preparation_id).toBe(`preparation.v1:sha256:${"8".repeat(64)}`);
  });

  it("sends the chosen file's bytes unchanged and shows each detection, which can be changed", async () => {
    const app = renderApp();
    await openWorkspace(app);
    const { file, upload, inspection } = await addSource(app);

    expect(upload.file).toBe(file);
    expect(importContract.uploadSourceMetadata(upload.request)).toBe(true);
    expect(upload.request.filename).toBe("Vorgänge.csv");
    expect(importContract.inspectRequest(inspection.request)).toBe(true);
    expect(inspection.request.hints).toBeUndefined();

    const encoding = screen.getByLabelText("Encoding") as HTMLSelectElement;
    const delimiter = screen.getByLabelText("Delimiter") as HTMLSelectElement;
    expect(encoding.value).toBe("windows-1252");
    expect(encoding.selectedOptions[0].textContent).toBe("Windows-1252 (Western European) (detected)");
    expect(delimiter.value).toBe(";");
    expect(delimiter.selectedOptions[0].textContent).toBe("Semicolon ; (detected)");
    expect(screen.getByText("4 records")).toBeTruthy();
    expect(screen.getByText("Column 2 has multiple possible timestamp formats; choose day/month order explicitly.")).toBeTruthy();
    const sample = screen.getByRole("table", { name: "The first records as read, by source position" });
    const header = within(sample).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(header).toEqual(["Position", "Vorgang · column 0", "Aktivität · column 1", "Zeitpunkt · column 2", "Gruppe · column 3"]);
    const rows = within(sample).getAllByRole("row").slice(1).map((row) => Array.from(row.children).map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["0", "A-1", "Eröffnet", "03.04.2026 08:00", "Büro"],
      ["1", "A-1", "Geschlossen", "04.04.2026 09:30", "missing"],
      ["2", "missing", "Eröffnet", "05.04.2026 07:15", "Unknown"],
      ["3", "B-2", "Prüfung", "xx", "Größe & Maß"],
    ]);

    await app.user.selectOptions(delimiter, ",");
    const comma = app.imports.inspections[1];
    expect(comma.request.hints).toEqual({ encoding: "windows-1252", delimiter: "," });
    expect(screen.getByText(/Inspecting Vorgänge\.csv/)).toBeTruthy();
    await deliver(() => comma.reply({ ok: true, answer: commaInspectionAnswer(comma.request) }));
    expect(within(screen.getByRole("table", { name: "The first records as read, by source position" })).getAllByRole("columnheader")).toHaveLength(2);

    await app.user.selectOptions(screen.getByLabelText("Encoding"), "utf-8");
    const utf8 = app.imports.inspections[2];
    expect(utf8.request.hints).toEqual({ encoding: "utf-8", delimiter: "," });
    await app.user.selectOptions(screen.getByLabelText("Delimiter"), ";");
    const semicolon = app.imports.inspections[3];
    expect(utf8.signal.aborted).toBe(true);
    // The reply to the abandoned reading arrives late and is not shown.
    await deliver(() => utf8.reply({ ok: true, answer: commaInspectionAnswer(utf8.request) }));
    expect(screen.queryByRole("table", { name: "The first records as read, by source position" })).toBeNull();
    await deliver(() => semicolon.reply({ ok: true, answer: inspectionAnswer(semicolon.request) }));
    expect(within(screen.getByRole("table", { name: "The first records as read, by source position" })).getAllByRole("columnheader")).toHaveLength(5);
  });

  it("puts an ambiguous date format as a question and sends the answer given", async () => {
    const app = renderApp();
    await openWorkspace(app);
    await addSource(app);
    await app.user.selectOptions(screen.getByLabelText("Incident id"), "0");
    await app.user.selectOptions(screen.getByLabelText("Activity"), "1");
    expect(screen.getByText("Choose the time column first.")).toBeTruthy();
    await app.user.selectOptions(screen.getByLabelText("Time"), "2");

    const question = screen.getByRole("group", { name: "These times can be read in more than one way. Which comes first: the day or the month?" });
    const choices = within(question).getAllByRole("radio") as HTMLInputElement[];
    expect(choices.map((choice) => choice.parentElement?.textContent)).toEqual([
      "Day first with dots: dd.mm.yyyy HH:MM — reads 3 filled cells of 4 filled cells",
      "Month first with dots: mm.dd.yyyy HH:MM — reads 3 filled cells of 4 filled cells",
    ]);
    expect(choices.some((choice) => choice.checked)).toBe(false);
    expect(within(question).getByText("03.04.2026 08:00 · 04.04.2026 09:30 · 05.04.2026 07:15")).toBeTruthy();
    const read = screen.getByRole("button", { name: "Read the source with these choices" }) as HTMLButtonElement;
    expect(read.disabled).toBe(true);
    expect(screen.getByText(/Still to choose: the time format, the zone of the times\./)).toBeTruthy();

    await app.user.click(within(question).getByLabelText(/Month first with dots/));
    await app.user.click(screen.getByLabelText("As recorded: no zone is applied"));
    expect(screen.getByText(/the difference between two times can be off by an hour/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Export taken at (as recorded)"), { target: { value: "2027-01-01T00:00" } });
    expect(read.disabled).toBe(false);
    await app.user.click(read);

    const confirmation = app.imports.confirmations[0].request;
    expect(importContract.confirmMappingRequest(confirmation)).toBe(true);
    expect(confirmation.mapping).toEqual({ case_column: 0, activity_column: 1, timestamp_column: 2, sequence_column: null, context_columns: [] });
    expect(confirmation.policies.time).toEqual({
      id: "incident.time.wall_clock_as_recorded.v1",
      parameters: { format: "mdy_dot_minute", timezone: "none_as_recorded", snapshot_cutoff_local: "2027-01-01T00:00:00" },
    });
    expect(confirmation.accept_report_issues).toBe(false);
  });

  it("shows the report and asks for an explicit confirmation of rows with issues before the incidents open", async () => {
    const app = renderApp();
    await openWorkspace(app);
    await addSource(app);
    await chooseReading(app);
    await app.user.click(screen.getByRole("button", { name: "Read the source with these choices" }));
    const first = app.imports.confirmations[0];
    expect(first.request.policies.time).toEqual({
      id: "incident.time.explicit_format_timezone_utc.v1",
      parameters: { format: "dmy_dot_minute", timezone: { mode: "fixed_offset", offset_minutes: 120 }, snapshot_cutoff_utc: "2027-01-01T00:00:00Z" },
    });
    expect(first.request.mapping.context_columns).toEqual([3]);
    expect(screen.getByText(/Reading every record with these choices/)).toBeTruthy();
    const pending = interpretationAnswer(first.request);
    expect(importContract.interpretationAnswer(pending)).toBe(true);
    await deliver(() => first.reply({ ok: true, answer: pending }));

    expect(screen.getByText(/Some rows have issues/)).toBeTruthy();
    expect(figure("Records read")).toBe("4 records");
    expect(figure("With an incident id")).toBe("3 records");
    expect(figure("Without incident id: outside every incident")).toBe("1 record");
    expect(figure("With a usable time")).toBe("3 records");
    expect(figure("Without a usable time: kept, order not known")).toBe("1 record");
    expect(figure("Incidents")).toBe("2 incidents");
    expect(figure("First usable time")).toBe("2026-04-03 06:00:00 UTC");
    expect(figure("Last usable time")).toBe("2026-04-05 05:15:00 UTC");
    expect(figure("Tied times within an incident")).toBe("0 groups of 0 records");
    const missing = screen.getByRole("table", { name: "Empty cells in the columns with a role, over all records read" });
    expect(within(missing).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([
      "Vorgang1 record",
      "Aktivität0 records",
      "Zeitpunkt0 records",
      "Gruppe1 record",
    ]);
    const issues = screen.getByText("Rows with issues, by reason").parentElement!;
    expect(within(issues).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "No incident id: outside every incidentNeeds your confirmationSource position 2",
      "Time not readable with the chosen format: kept in its incident, order not knownNeeds your confirmationSource position 3",
    ]);
    expect(screen.queryByRole("button", { name: "Open incidents" })).toBeNull();

    const confirm = screen.getByRole("button", { name: "Confirm and prepare" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await app.user.click(screen.getByLabelText("I have read the rows with issues; keep them as described above."));
    await app.user.click(confirm);
    const second = app.imports.confirmations[1];
    expect(second.request.accept_report_issues).toBe(true);
    expect({ ...second.request, request_id: "", query_revision: 0, accept_report_issues: false }).toEqual({
      ...first.request,
      request_id: "",
      query_revision: 0,
    });
    await deliver(() => second.reply({ ok: true, answer: interpretationAnswer(second.request) }));
    expect(screen.getByText(/Ready: the source is read with these choices/)).toBeTruthy();

    await app.user.click(screen.getByRole("button", { name: "Open incidents" }));
    const population = app.imports.populations[0];
    expect(population.request.workspace_id).toBe("workspace.v1:0123456789abcdef");
    expect(population.request.preparation_id).toBe(`preparation.v1:sha256:${"6".repeat(64)}`);
    await deliver(() => population.reply({ ok: true, answer: populationAnswer(population.request) }));

    expect(screen.getByRole("heading", { name: "Vorgänge.csv" })).toBeTruthy();
    const facts = screen.getByLabelText("Population");
    expect(facts.textContent).toBe("Incidents2 incidentsRecords of these incidents3 recordsRows without incident id1 rowRecords without activity label0 recordsRevision1");
    const table = screen.getByRole("table", { name: "Incidents of this preparation" });
    expect(within(table).getAllByRole("row").slice(1).map((row) => Array.from(row.children).map((cell) => cell.textContent))).toEqual([
      ["A-1", "2", "2", "0", "By time"],
      ["B-2", "1", "1", "0", "Not fully known"],
    ]);
  });

  it("shows a refused reading with what to do, and a changed choice clears an earlier report", async () => {
    const app = renderApp();
    await openWorkspace(app);
    await addSource(app);
    await chooseReading(app);
    await app.user.click(screen.getByLabelText("Offsets written in the values, for example Z or +02:00"));
    await app.user.click(screen.getByRole("button", { name: "Read the source with these choices" }));
    const refused = app.imports.confirmations[0];
    expect(refused.request.policies.time.parameters.timezone).toEqual({ mode: "from_values" });
    await deliver(() =>
      refused.reply(
        importRefusal(
          refused.request,
          "confirm_mapping",
          "timezone_required",
          "A timestamp without a zone needs an explicit wall-clock or fixed-offset interpretation.",
          "policies.time",
        ),
      ),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The source cannot be read with these choices");
    expect(alert.textContent).toContain("A timestamp without a zone needs an explicit wall-clock or fixed-offset interpretation.");
    expect(alert.textContent).toContain("What to do These times carry no zone. Choose “as recorded” or a fixed offset.");

    await app.user.click(screen.getByLabelText("One fixed offset for every time"));
    expect(screen.queryByRole("alert")).toBeNull();
    await app.user.click(screen.getByRole("button", { name: "Read the source with these choices" }));
    const answered = app.imports.confirmations[1];
    await deliver(() => answered.reply({ ok: true, answer: interpretationAnswer(answered.request) }));
    expect(screen.getByText(/Some rows have issues/)).toBeTruthy();

    await app.user.selectOptions(screen.getByLabelText("Offset from UTC"), "60");
    expect(screen.queryByText(/Some rows have issues/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm and prepare" })).toBeNull();
  });

  it("drops a late report of choices that were changed meanwhile", async () => {
    const app = renderApp();
    await openWorkspace(app);
    await addSource(app);
    await chooseReading(app);
    await app.user.click(screen.getByRole("button", { name: "Read the source with these choices" }));
    const stale = app.imports.confirmations[0];
    await app.user.selectOptions(screen.getByLabelText("Offset from UTC"), "60");
    expect(stale.signal.aborted).toBe(true);
    await deliver(() => stale.reply({ ok: true, answer: interpretationAnswer(stale.request) }));
    expect(screen.queryByText(/Some rows have issues/)).toBeNull();
    await deliver(() =>
      stale.reply(importRefusal(stale.request, "confirm_mapping", "computation_failed", "The answer could not be computed.")),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
