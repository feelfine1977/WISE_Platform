import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { SimilarSequencesAnswer, SimilarSequencesRequest } from "../generated/similar-sequences";
import { identity, workspaceId } from "../test/imports";
import { type SimilarOutcome, similarContract } from "./client";
import { SimilarSequences } from "./SimilarSequences";

function answerOf(request: SimilarSequencesRequest): SimilarSequencesAnswer {
  const family = (activities: string[], distance: number, kept: string[], parent = kept.length) => ({ activities, distance, parent_case_count: parent, kept_case_ids: kept, exemplars: [kept[0] ?? "X"] });
  const families = [family(["A", "B", "D"], 0, ["K-1", "K-2"]), family(["A", "D"], 1, ["K-3"], 2), ...(request.maximum_edits > 1 ? [family(["A"], 2, ["K-4"])] : [])];
  return { schema_version: 1, message_type: "similar_sequences_answer", request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id,
    identity: request.identity, parent_identity: request.identity, policy: "incident.sequence.similar.edit_distance.v1", anchor: request.anchor, maximum_edits: request.maximum_edits,
    parent: { case_count: 6, eligible_case_count: 5, unevaluable_case_count: 1 }, kept_case_count: 5,
    suggested_parent_case_count: families.reduce((sum, item) => sum + item.parent_case_count, 0), suggested_kept_case_count: families.reduce((sum, item) => sum + item.kept_case_ids.length, 0),
    family_count: families.length, families };
}

it("suggests the families within the edits allowed, by a stated method, and keeps one only as a step of its identifiers (#68)", async () => {
  const asked: SimilarSequencesRequest[] = [];
  const replies: ((outcome: SimilarOutcome) => void)[] = [];
  const onStep = vi.fn(), onOpenCase = vi.fn();
  const user = userEvent.setup();
  render(<SimilarSequences workspaceId={workspaceId} identity={identity} revision={4} anchor={["A", "B", "D"]} anchorName="variant 1" onStep={onStep} onOpenCase={onOpenCase}
    client={{ similar: (request) => new Promise((reply) => { asked.push(request); replies.push(reply); }) }} />);
  expect(similarContract.request(asked[0]) && asked[0].maximum_edits === 1).toBe(true);
  await act(async () => replies[0]({ ok: true, answer: answerOf(asked[0]) }));
  expect(screen.getByText(/the least number of activities to insert, remove or replace/)).toBeTruthy();
  expect(screen.getByText(/2 families of exactly equal sequences within 1 edit: 4 incidents of the 5 eligible incidents of the parent, 3 kept incidents of 5\. 1 incident of the parent is not eligible/)).toBeTruthy();
  expect(onStep).not.toHaveBeenCalled();
  await user.click(screen.getByRole("radio", { name: "At most 2 edits" }));
  expect(asked[1].maximum_edits).toBe(2);
  await act(async () => replies[1]({ ok: true, answer: answerOf(asked[1]) }));
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "Open K-3, a complete history of this family" }));
  expect(onOpenCase).toHaveBeenCalledWith("K-3");
  await user.click(screen.getByRole("button", { name: "Keep the 4 kept incidents suggested" }));
  expect(onStep).toHaveBeenCalledWith({ kind: "case_id_in", case_ids: ["K-1", "K-2", "K-3", "K-4"], negate: false });
  expect(screen.getByText(/A family is not a business class, a cause or a prediction\./)).toBeTruthy();
});
