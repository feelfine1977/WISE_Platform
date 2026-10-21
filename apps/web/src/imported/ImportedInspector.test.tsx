import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { importContract } from "../data/client";
import type { ImportedCaseEvidenceAnswer, ImportedCaseEvidenceRequest, ImportedSourceRecord } from "../generated/imports";
import { evidenceAnswer, identity, workspaceId } from "../test/imports";
import { diagnosticsFor } from "../test/incidentTime";
import { ImportedInspector } from "./ImportedInspector";

const request: ImportedCaseEvidenceRequest = {
  schema_version: 1,
  message_type: "imported_case_evidence_request",
  request_id: "evidence-1",
  query_revision: 1,
  workspace_id: workspaceId,
  identity,
  case_id: "A-1",
};

/*
 * The scripted evidence of A-1: "Eröffnet" at 06:00 UTC on 3 April, a record without activity label
 * at 07:30 UTC on 4 April, 25.5 hours after it, and "Prüfung" whose time is not readable. Its order
 * cannot be evaluated.
 */
// The scripted incident with the time diagnostics the local service supplies with it.
const bare = evidenceAnswer(request);
const scripted: ImportedCaseEvidenceAnswer = { ...bare, incident_time: diagnosticsFor(bare.records, bare.sequence_evaluable) };

/**
 * The scripted incident with other records, written by hand: each has an activity or none and a
 * time or none. A time that ends in Z is a UTC instant, any other a wall-clock time as recorded.
 */
function incidentOf(listed: [activity: string | null, time: string | null][], evaluable: boolean): ImportedCaseEvidenceAnswer {
  const records = listed.map(([activity, time], place) => {
    const instant = time !== null && time.endsWith("Z");
    return {
      ...scripted.records[0],
      row_id: `row.v1:sha256:${"0123456789abcdef"[place].repeat(64)}`,
      source_position: place,
      activity,
      timestamp_kind: time === null || instant ? "utc_instant" : "wall_clock",
      timestamp_status: time === null ? "invalid" : "usable",
      utc_instant: instant ? time : null,
      local_timestamp: time === null || instant ? null : time,
      context: [{ column_index: 3, value: null }],
      original_cells: ["A-1", activity ?? "", time ?? "xx", ""],
    } as ImportedSourceRecord;
  });
  const labelled = records.filter((record) => record.activity !== null);
  const answer = {
    ...scripted,
    sequence_evaluable: evaluable,
    coverage: { raw_record_count: records.length, mapped_record_count: labelled.length, omitted_activity_record_count: records.length - labelled.length },
    records,
    mapped_row_ids: labelled.map((record) => record.row_id),
    omitted_activity_row_ids: records.filter((record) => record.activity === null).map((record) => record.row_id),
    incident_time: diagnosticsFor(records, evaluable),
  } as ImportedCaseEvidenceAnswer;
  expect(importContract.caseEvidenceAnswer(answer)).toBe(true);
  return answer;
}

/*
 * Five records in a known order, by hand: two at 06:00:00 UTC on 3 April, one 30 minutes after them,
 * one 26 hours after that and one another 26 hours on. From the earliest to the latest: 52.5 hours,
 * which is said in days as every time from 48 hours on.
 */
const ordered = incidentOf(
  [
    ["Eröffnet", "2026-04-03T06:00:00Z"],
    ["Zugewiesen", "2026-04-03T06:00:00Z"],
    [null, "2026-04-03T06:30:00Z"],
    ["Prüfung", "2026-04-04T08:30:00Z"],
    ["Geschlossen", "2026-04-05T10:30:00Z"],
  ],
  true,
);

function renderIncident(answer: ImportedCaseEvidenceAnswer) {
  const user = userEvent.setup();
  render(
    <ImportedInspector
      inspected={{ phase: "ready", caseId: answer.case_id, answer }}
      summary={undefined}
      layout="side"
      onLayout={() => undefined}
      onReturn={() => undefined}
      onRetry={() => undefined}
      headingRef={createRef<HTMLHeadingElement>()}
    />,
  );
  const timeline = screen.getByRole("region", { name: "Elapsed time of case A-1" });
  const entries = within(screen.getByRole("list", { name: "Records of case A-1 in the declared order" })).getAllByRole("listitem");
  return { user, timeline, entries };
}

function stripOf(timeline: HTMLElement) {
  const strip = within(timeline).getByRole("group", { name: "Recorded times of case A-1, the earliest at the left and the latest at the right" });
  return { strip, marks: within(strip).getAllByRole("button") };
}

const gapsOf = (entries: HTMLElement[]) => entries.map((entry) => entry.querySelector(".history-gap")?.textContent ?? null);
const placeOf = (mark: HTMLElement) => mark.querySelector(".timeline-dot")?.getAttribute("cx");
const claims = /\b(?:wait\w*|delay\w*|resolv\w*|late|overdue)\b/i;

describe("the timeline of one case", () => {
  it("draws the timed records of the scripted case, counts the record without a readable time, and computes no gap while the order cannot be evaluated", () => {
    expect(importContract.caseEvidenceAnswer(scripted)).toBe(true);
    const { timeline, entries } = renderIncident(scripted);

    // The order is not known, so the service gives no span and no time since the earliest: the strip says the distinct times only.
    expect(timeline.querySelector(".timeline-elapsed")?.textContent).toBe("2 distinct times");
    const { marks } = stripOf(timeline);
    expect(marks.map((mark) => mark.getAttribute("aria-label"))).toEqual(["2026-04-03 06:00:00 UTC: 1 record", "2026-04-04 07:30:00 UTC: 1 record"]);
    expect(marks.map(placeOf)).toEqual(["0%", "100%"]);
    expect(timeline.querySelector(".timeline-ends")?.textContent).toBe("2026-04-03 06:00:00 UTC2026-04-04 07:30:00 UTC");
    expect(within(timeline).getByText("1 record without a readable time is not on the strip.")).toBeTruthy();

    expect(within(timeline).getByText("No gap is given for this case:", { exact: false }).textContent).toContain(
      "the local service says that the order of its records cannot be evaluated",
    );
    expect(timeline.textContent).not.toContain("Longest gap");
    expect(timeline.querySelector(".timeline-longest-span")).toBeNull();
    expect(gapsOf(entries)).toEqual([null, null, null]);
    expect(timeline.textContent).not.toContain("The elapsed times here");

    // The list stays the complete evidence in its declared order.
    expect(entries.map((entry) => entry.querySelector(".history-activity")?.textContent)).toEqual(["Eröffnet", "no activity label", "Prüfung"]);
    expect(timeline.textContent).not.toMatch(claims);
  });

  it("moves the focus from a mark to its first record in the list, by pointer and by keyboard", async () => {
    const { user, timeline, entries } = renderIncident(scripted);
    const { strip, marks } = stripOf(timeline);

    await user.click(marks[1]);
    expect(document.activeElement).toBe(entries[1]);
    // The area around a mark takes the pointer as the mark does.
    await user.click(strip.querySelectorAll(".timeline-hit")[0]);
    expect(document.activeElement).toBe(entries[0]);

    // Only one mark is a tab stop; the arrow keys, Home and End move between the marks.
    expect(marks.map((mark) => mark.getAttribute("tabindex"))).toEqual(["-1", "0"]);
    // Between the strip and the list stands the way to the record without a readable time.
    await user.tab({ shift: true });
    expect(document.activeElement?.textContent).toMatch(/^source position \d+$/);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(marks[1]);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(marks[0]);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(marks[0]);
    expect(marks.map((mark) => mark.getAttribute("tabindex"))).toEqual(["0", "-1"]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(marks[1]);
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(entries[1]);

    marks[1].focus();
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(marks[0]);
    await user.keyboard(" ");
    expect(document.activeElement).toBe(entries[0]);
  });

  it("keeps records at exactly the same time on one mark with their count, and leads to the first of them", async () => {
    const { user, timeline, entries } = renderIncident(ordered);
    const { marks } = stripOf(timeline);

    expect(within(timeline).getByText("Elapsed from the earliest to the latest recorded time:", { exact: false }).textContent).toBe(
      "Elapsed from the earliest to the latest recorded time: 2.2 days · 4 distinct times",
    );
    expect(marks.map((mark) => mark.getAttribute("aria-label"))).toEqual([
      "2026-04-03 06:00:00 UTC, the earliest recorded time: 2 records",
      "2026-04-03 06:30:00 UTC, 30.0 minutes after the earliest recorded time: 1 record",
      "2026-04-04 08:30:00 UTC, 26.5 hours after the earliest recorded time: 1 record",
      "2026-04-05 10:30:00 UTC, 2.2 days after the earliest recorded time: 1 record",
    ]);
    // Linear in the elapsed time: 0.5, 26.5 and 52.5 of 52.5 hours.
    expect(marks.map(placeOf)).toEqual(["0%", "0.952%", "50.476%", "100%"]);
    expect(marks.map((mark) => mark.querySelector(".timeline-count")?.textContent ?? null)).toEqual(["×2", null, null, null]);
    expect(marks.map((mark) => mark.querySelector("title")?.textContent)).toEqual(marks.map((mark) => mark.getAttribute("aria-label")));
    expect(within(timeline).queryByText("not on the strip", { exact: false })).toBeNull();

    await user.click(marks[0]);
    expect(document.activeElement).toBe(entries[0]);
    expect(entries).toHaveLength(5);
  });

  it("writes the gap since the record before under each record, and names the longest gap once with its two records", async () => {
    const { user, timeline, entries } = renderIncident(ordered);

    expect(gapsOf(entries)).toEqual([
      null,
      "Gap since the record before: none, the same recorded time",
      "Gap since the record before: 30.0 minutes",
      "Gap since the record before: 26.0 hours",
      "Gap since the record before: 26.0 hours",
    ]);
    // The time and the place of a record stay as they were written.
    expect(entries[3].querySelector(".history-meta")?.textContent).toBe("2026-04-04 08:30:00 UTC · source position 3");

    const longest = timeline.querySelector(".timeline-longest");
    expect(longest?.textContent).toBe(
      "Longest gap: 26.0 hours, between a record without activity label (2026-04-03 06:30:00 UTC, source position 2) " +
        "and “Prüfung” (2026-04-04 08:30:00 UTC, source position 3). It is the first of 2 gaps of this length in the declared order. " +
        "Show this gap in the list",
    );
    expect(document.body.textContent?.match(/Longest gap/g)).toHaveLength(1);
    // Of the two equal gaps the first is the one marked: in the list and on the strip, from 0.5 to 26.5 of 52.5 hours.
    expect(entries.map((entry) => entry.querySelector(".history-gap.longest") !== null)).toEqual([false, false, false, true, false]);
    const span = timeline.querySelector(".timeline-longest-span");
    expect([span?.getAttribute("x1"), span?.getAttribute("x2")]).toEqual(["0.952%", "50.476%"]);
    expect(within(timeline).queryByText("No gap is computed", { exact: false })).toBeNull();

    await user.click(within(timeline).getByRole("button", { name: "Show this gap in the list" }));
    expect(document.activeElement).toBe(entries[3]);
    expect(timeline.textContent).not.toMatch(claims);
    expect(gapsOf(entries).join(" ")).not.toMatch(claims);
  });

  it("says in place of the axis that a case has one record", () => {
    const { timeline, entries } = renderIncident(incidentOf([["Eröffnet", "2026-04-03T06:00:00Z"]], true));
    expect(timeline.textContent).toBe("This case has one record, at 2026-04-03 06:00:00 UTC; there is no elapsed time to draw.");
    expect(timeline.querySelector("svg")).toBeNull();
    expect(gapsOf(entries)).toEqual([null]);
  });

  it("says of one record without a readable time only that, and withholds no gap where none can be", () => {
    const { timeline, entries } = renderIncident(incidentOf([["Prüfung", null]], false));
    expect(timeline.textContent).toBe("No record of this case has a readable time; there is no elapsed time to draw.");
    expect(gapsOf(entries)).toEqual([null]);
  });

  it("says in place of the axis that every record carries the same time", () => {
    const same = incidentOf(
      [
        ["Eröffnet", "2026-04-03T06:00:00Z"],
        ["Zugewiesen", "2026-04-03T06:00:00Z"],
        ["Geschlossen", "2026-04-03T06:00:00Z"],
      ],
      true,
    );
    const { timeline, entries } = renderIncident(same);
    expect(within(timeline).getByText("All 3 records of this case carry the same recorded time, 2026-04-03 06:00:00 UTC; there is no elapsed time to draw.")).toBeTruthy();
    expect(timeline.querySelector("svg")).toBeNull();
    // Every gap is zero, and zero is said: it is a computed gap, not a missing one.
    expect(timeline.textContent).toContain("Longest gap: none above zero");
    expect(timeline.textContent).toContain("It is the first of 2 gaps of this length in the declared order.");
    expect(gapsOf(entries)).toEqual([null, "Gap since the record before: none, the same recorded time", "Gap since the record before: none, the same recorded time"]);
  });

  it("says what a recorded wall clock does not say", () => {
    const recorded = incidentOf(
      [
        ["Eröffnet", "2026-03-29T01:30:00"],
        ["Geschlossen", "2026-03-29T03:30:00"],
      ],
      true,
    );
    const { timeline, entries } = renderIncident(recorded);
    expect(timeline.querySelector(".timeline-ends")?.textContent).toBe("2026-03-29 01:30:00 as recorded2026-03-29 03:30:00 as recorded");
    expect(gapsOf(entries)).toEqual([null, "Gap since the record before: 2.0 hours"]);
    expect(within(timeline).getByText("The times are wall-clock times as recorded; across a clock change a difference may differ from the physical elapsed time.", { exact: false })).toBeTruthy();
  });

  it("gives no gap at all where a record has no readable time, since the local service then holds the order to be unknown", () => {
    const broken = incidentOf(
      [
        ["Eröffnet", "2026-04-03T06:00:00Z"],
        ["Prüfung", null],
        ["Geschlossen", "2026-04-05T06:00:00Z"],
      ],
      false,
    );
    const { timeline, entries } = renderIncident(broken);
    expect(gapsOf(entries)).toEqual([null, null, null]);
    expect(timeline.textContent).not.toContain("Longest gap");
    expect(within(timeline).getByText("1 record without a readable time is not on the strip.")).toBeTruthy();
    // The two readable times still stand as marks; the record without one can be reached from the row under the strip.
    expect(within(timeline).getAllByRole("button").length).toBeGreaterThanOrEqual(3);
  });

  it("says the wall clock of the times also where the order is not known and no gap is given", () => {
    const recorded = incidentOf(
      [
        ["Eröffnet", "2026-03-29T01:30:00"],
        ["Prüfung", "2026-03-29T03:30:00"],
      ],
      false,
    );
    const { timeline } = renderIncident(recorded);
    expect(within(timeline).getByText(/^Wall clock: the times are wall-clock times as recorded/)).toBeTruthy();
    expect(timeline.textContent).not.toContain("The elapsed times here");
  });

  it("draws and computes nothing where the local service supplied no time diagnostics, and says so", () => {
    const { incident_time: _supplied, ...legacy } = ordered;
    void _supplied;
    const { timeline, entries } = renderIncident(legacy as ImportedCaseEvidenceAnswer);
    expect(timeline.textContent).toContain("Time diagnostics were not supplied for this case, so no elapsed time is drawn or computed here.");
    expect(gapsOf(entries).every((gap) => gap === null)).toBe(true);
    expect(timeline.textContent).not.toContain("Longest gap");
  });
});
