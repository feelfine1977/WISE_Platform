import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ConfirmMappingRequest, InterpretationAnswer } from "../generated/imports";
import { interpretationAnswer, preparationId, sourceId, workspaceId } from "../test/imports";
import { workspaceExamples } from "./examples";
import { ImportGuide } from "./ImportGuide";
import { confirmationOf, delimiters, emptyDraft, encodings, formatLabels, timeFormats } from "./interpretation";
import { Report } from "./Report";

const names = new Map([[0, "Vorgang"], [1, "Aktivität"], [2, "Zeitpunkt"], [3, "Gruppe"]]);
const draft = { ...emptyDraft, encoding: "utf-8" as const, delimiter: ";" as const, caseColumn: 0, activityColumn: 1, timestampColumn: 2,
  contextColumns: [3], timeFormat: "dmy_dot_minute" as const, zone: "fixed_offset" as const, offsetMinutes: 120, cutoff: "2027-01-01T00:00" };

function request(accept: boolean): ConfirmMappingRequest {
  return confirmationOf(draft, { workspaceId, sourceId }, { requestId: `r-${accept}`, revision: 1 }, accept)!;
}

function report(answer: InterpretationAnswer, sent: ConfirmMappingRequest) {
  const onOpenIncidents = vi.fn(), onAccept = vi.fn();
  render(<Report request={sent} answer={answer} filename="Vorgänge.csv" names={names} onAccept={onAccept} onOpenIncidents={onOpenIncidents} />);
  return { onOpenIncidents, onAccept, user: userEvent.setup() };
}

describe("#4 what WISE understood, before the incidents open", () => {
  it("reconciles the records, names each role's column and the reading, and gives the identities", async () => {
    const sent = request(true);
    const { onOpenIncidents, user } = report(interpretationAnswer(sent), sent);
    const summary = screen.getByRole("region", { name: "What WISE understood" });
    // The service's figures: 4 records read, 3 in 2 incidents, 1 outside every incident.
    expect(summary.textContent).toContain("4 records read from Vorgänge.csv: 3 records in 2 incidents, and 1 record outside every incident.");
    expect(summary.textContent).toContain("Each row is read as one recorded event or change of its incident.");
    const roles = Object.fromEntries(within(summary).getAllByRole("term").map((term) => [term.textContent, term.nextElementSibling?.textContent]));
    expect(roles).toMatchObject({
      "Incident id": "“Vorgang”",
      Activity: "“Aktivität”",
      Time: `“Zeitpunkt”, read as ${formatLabels.dmy_dot_minute}, one fixed offset for every time, UTC+02:00`,
      "Sequence number": "none: equal times keep the order of the file",
      "Context attributes": "“Gruppe”",
      "Written as": "UTF-8; Semicolon ; as the delimiter; the first record as the header",
      Source: sourceId,
      Preparation: preparationId,
    });
    // Empty cells and literal values are described as the fixed policy reads them, and no other policy is offered.
    expect(summary.textContent).toContain("such as 0, False or Unknown, is kept exactly as written and is never read as missing");
    expect(screen.queryByRole("note")).toBeNull();
    // A new report takes the focus, so that the keyboard continues from what the reading gave.
    expect(document.activeElement?.textContent).toBe("What WISE understood");
    await user.click(screen.getByRole("button", { name: "Open incidents" }));
    expect(onOpenIncidents).toHaveBeenCalledWith(preparationId);
  });

  it("names no preparation while rows with issues wait for a confirmation", () => {
    const sent = request(false);
    report(interpretationAnswer(sent), sent);
    const summary = screen.getByRole("region", { name: "What WISE understood" });
    expect(summary.textContent).toContain("given once the rows with issues are confirmed");
    expect(screen.getByRole("button", { name: "Confirm and prepare" })).toBeTruthy();
  });

  it("explains a file of one record per incident and opens it only when chosen", async () => {
    const sent = request(true);
    const base = interpretationAnswer(sent);
    const answer = { ...base, report: { ...base.report, raw_record_count: 3, identified_record_count: 3, unassigned_record_count: 0, case_count: 3 } };
    const { onOpenIncidents, user } = report(answer, sent);
    expect(screen.getByRole("note").textContent).toContain("Every incident has exactly one record.");
    const open = screen.getByRole("button", { name: "Open incidents" });
    expect((open as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Open them as incidents of one record each." }));
    await user.click(open);
    expect(onOpenIncidents).toHaveBeenCalledWith(preparationId);
  });

  it("says nothing of the shape when only a blocked reading came back", () => {
    const sent = request(false);
    report({ ...interpretationAnswer(sent), state: "blocked", preparation: null }, sent);
    expect(screen.queryByRole("region", { name: "What WISE understood" })).toBeNull();
  });
});

describe("#4 the guide to reading a CSV", () => {
  it("names the roles and every option the screen offers, and reads a packaged synthetic example", async () => {
    const onLoadExample = vi.fn();
    render(<ImportGuide onLoadExample={onLoadExample} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("How WISE reads a CSV file"));
    const guide = screen.getByText("How WISE reads a CSV file").closest("details")!;
    for (const role of ["Incident id", "Activity", "Time", "Sequence number (optional)", "Context attributes (optional)"]) expect(within(guide).getByText(role)).toBeTruthy();
    for (const option of [...encodings.map((item) => item.label), ...delimiters.map((item) => item.label), ...timeFormats.map((format) => formatLabels[format])]) {
      expect(guide.textContent).toContain(option);
    }
    expect(guide.textContent).toContain("Each row of the file is one recorded event or change of an incident");
    expect(guide.textContent).toContain("nothing is sent elsewhere");
    await user.click(screen.getByRole("button", { name: "Load the synthetic example and read it" }));
    expect(onLoadExample).toHaveBeenCalledWith(workspaceExamples.find((item) => item.id === "S3"));
  });
});
