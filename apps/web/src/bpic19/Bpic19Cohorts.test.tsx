import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Bpic19CohortsRequest, Bpic19CohortsAnswer } from "../generated/bpic19-cohorts";
import fixture from "./cohorts-test-answer.json";
import { Bpic19Cohorts } from "./Bpic19Cohorts";
import { cohortsContract, type CohortsClient, type CohortsOutcome } from "./cohorts-client";

if (!cohortsContract.answer(fixture)) throw new Error("Bad literal cohort fixture");
const answer: Bpic19CohortsAnswer = fixture;
function respond(request: Bpic19CohortsRequest): CohortsOutcome {
  const { page: _page, ...definition } = request.query;
  return { ok: true, answer: { ...answer, request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id, identity: request.identity, query: request.query, definition,
    cohorts: { ...answer.cohorts, definition } } };
}
function props(client: CohortsClient = { cohorts: vi.fn(async request => respond(request)) }) {
  return { workspaceId: answer.workspace_id, identity: answer.identity, revision: 1, roles: answer.query.roles, timestampKind: "wall_clock" as const,
    onInspect: vi.fn(), onKeepCases: vi.fn(), onReviewed: vi.fn(), onValidityChange: vi.fn(), client };
}

describe("recorded completion cohorts", () => {
  it("opens an unscored all-item question, presents exact states, keeps complete IDs and opens witness rows", async () => {
    const p=props();render(<Bpic19Cohorts {...p}/>);const user=userEvent.setup();
    await screen.findByRole("table",{name:"Whole-item stages and recorded completion"});
    expect(screen.getAllByText(/9 PO items · 13 original records/)).toHaveLength(3);
    await user.click(screen.getByRole("button",{name:"Keep Recorded closed"}));
    expect(p.onKeepCases).toHaveBeenCalledWith(["K","L","P","T"]);
    await user.click(screen.getByRole("button",{name:"Inspect K"}));
    const witness=answer.cohorts.page.items.find(i=>i.case_id==="K")!;
    expect(p.onInspect).toHaveBeenCalledWith("K",witness.witness_row_ids);
    expect(p.onReviewed).toHaveBeenCalled();expect(p.onValidityChange).toHaveBeenLastCalledWith(true);
    expect(screen.getAllByText(/Due assessment unavailable/).length).toBe(9);
  });
  it("pauses keeping and saving while a meaning-bearing definition is edited, then emits the exact reviewed query", async () => {
    const p=props();render(<Bpic19Cohorts {...p}/>);const user=userEvent.setup();
    await screen.findByRole("button",{name:"Keep Recorded closed"});
    await user.click(screen.getByText("Inclusion and completion definition"));
    await user.selectOptions(screen.getByLabelText("Retain for analysis"),"observed_closed");
    expect(screen.getByRole("button",{name:"Keep Recorded closed"}).hasAttribute("disabled")).toBe(true);
    expect(p.onValidityChange).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole("button",{name:"Review this cohort"}));
    await screen.findByRole("table",{name:"Whole-item stages and recorded completion"});
    expect(p.onReviewed.mock.lastCall?.[0].query.retain).toBe("observed_closed");
  });
  it("fences an old success and failure after the source/population revision changes", async () => {
    const pending: Array<{request:Bpic19CohortsRequest;resolve:(value:CohortsOutcome)=>void}>=[];
    const client:CohortsClient={cohorts:vi.fn(request=>new Promise<CohortsOutcome>(resolve=>pending.push({request,resolve})))};
    const p=props(client);const view=render(<Bpic19Cohorts {...p}/>);
    view.rerender(<Bpic19Cohorts {...p} revision={2}/>);
    pending[1].resolve(respond(pending[1].request));
    await screen.findByRole("table",{name:"Whole-item stages and recorded completion"});
    pending[0].resolve({ok:false,problem:{kind:"unreachable"}});
    expect(p.onReviewed).toHaveBeenCalledTimes(1);
    expect(p.onReviewed.mock.lastCall?.[0].query_revision).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("reports cancellation and an explicit retry without keeping the earlier answer", async () => {
    const client:CohortsClient={cohorts:vi.fn(()=>new Promise<CohortsOutcome>(()=>{}))};
    const p=props(client);render(<Bpic19Cohorts {...p}/>);const user=userEvent.setup();
    await user.click(screen.getByRole("button",{name:"Cancel cohort review"}));
    expect(screen.getByRole("alert").textContent).toContain("cancelled");
    expect(p.onValidityChange).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole("button",{name:"Retry cohort"}));
    expect(client.cohorts).toHaveBeenCalledTimes(2);
  });
});
