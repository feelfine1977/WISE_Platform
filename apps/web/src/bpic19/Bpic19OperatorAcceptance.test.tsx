import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import fixtures from "./operator-acceptance-test-answers.json";
import { Bpic19Operators } from "./Bpic19Operators";
import { bpic19OperatorContract, type Bpic19OperatorClient, type Bpic19OperatorOutcome } from "./operators-client";
import { sameJson } from "../data/coordinator";

function setup(kind: "cancellation" | "waiting" | "every") {
  const source: unknown = structuredClone(fixtures[kind]);
  if (!bpic19OperatorContract.answer(source)) throw new Error("Captured synthetic HTTP receipt violates the operator contract.");
  const answer = source;
  const client: Bpic19OperatorClient = { operators: vi.fn(async (request): Promise<Bpic19OperatorOutcome> => {
    if (!sameJson(request.query, answer.query) || !sameJson(request.identity, answer.identity)) return { ok: false, problem: { kind: "unsupported_reply", detail: "Only this captured, independently checked literal query is admitted by the presentation fixture." } };
    return { ok: true, answer: { ...answer, request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id } };
  }) };
  const props = { workspaceId: answer.workspace_id, identity: answer.identity, revision: 2, roles: answer.query.roles,
    query: answer.query, columns: answer.catalogue.columns, client, onInspect: vi.fn(), onReviewed: vi.fn(), onValidityChange: vi.fn() };
  render(<Bpic19Operators {...props} />);
  return { answer, props, user: userEvent.setup() };
}

describe("public presentation of independently checked G08 HTTP literals", () => {
  it("shows separate sum, mean, creation and retained amount evidence for20-AC05 without rewriting the hypothetical receipt view", async () => {
    const { answer, props, user } = setup("cancellation");
    await waitFor(() => expect(props.onReviewed).toHaveBeenCalledTimes(1));
    await user.click(screen.getByText(/Item V · evaluated · 5 original records/));
    const table = await screen.findByRole("table", { name: "Item V raw totals" });
    expect(within(table).getByRole("row", { name: /raw receipt sum/ }).textContent).toContain("80 EUR");
    expect(within(table).getByRole("row", { name: /raw receipt mean/ }).textContent).toContain("26.6667 EUR");
    expect(within(table).getByRole("row", { name: /raw receipt maximum absolute/ }).textContent).toContain("100 EUR");
    expect(within(table).getByRole("row", { name: /unique creation value/ }).textContent).toContain("100 EUR");
    expect(within(table).getByRole("row", { name: /retained receipt sum/ }).textContent).toContain("100 EUR");
    expect(within(table).getByRole("row", { name: /retained receipt mean/ }).textContent).toContain("50 EUR");
    expect(screen.getByText(/Hypothetically excluded receipt targets:/)).toBeTruthy();
    const v = answer.cases.find(value => value.case_id === "V");if (!v) throw new Error("Literal V missing");
    expect(v.totals.raw_receipt_mean.value).toBe(80 / 3);
    await user.click(screen.getByRole("button", { name: "Inspect unique creation value" }));
    expect(props.onInspect).toHaveBeenLastCalledWith("V", v.totals.unique_creation_value.row_ids);
    await user.click(screen.getByRole("button", { name: "Inspect complete item V" }));
    expect(props.onInspect).toHaveBeenLastCalledWith("V", v.record_row_ids);
  });
  it("shows censored versus unknown-response versus reversed observations for22-AC02/04 with original witnesses", async () => {
    const { answer, props, user } = setup("waiting");
    await waitFor(() => expect(props.onReviewed).toHaveBeenCalledTimes(1));
    for (const id of ["E", "F", "G"]) {
      const item = answer.cases.find(value => value.case_id === id);if (!item) throw new Error("Literal waiting item missing");
      await user.click(screen.getByText(`Item ${id} · ${item.state.replaceAll("_", " ")} · ${item.record_count} original records`));
      const table = await screen.findByRole("table", { name: `Item ${id} inferred observations and original witnesses` });
      expect(table.textContent).toContain(id === "E" ? "censored" : id === "F" ? "unknown response time" : "reversed interval");
      if (id === "E") expect(table.textContent).toContain("Partner none");
      if (id === "G") expect(table.textContent).toContain("Signed diagnostic -2 days");
      await user.click(within(table).getByRole("button", { name: `Inspect observation 1 of ${id}` }));
      const observedIds = props.onInspect.mock.calls.at(-1)?.[1];
      expect(observedIds).toContain(item.observations[0].activation_row_ids[0]);
      if (id === "F") expect(observedIds).toContain(item.observations[0].unknown_row_ids[0]);
    }
  });
  it("keeps confirmed evidence visible while missing activation support stays unknown for26-AC10", async () => {
    const { answer, props, user } = setup("every");
    await waitFor(() => expect(props.onReviewed).toHaveBeenCalledTimes(1));
    await user.click(screen.getByText(/Item U · unknown · rule unknown · 3 original records/));
    expect(screen.getByText(/known activations 1 \/ total unavailable/)).toBeTruthy();
    const table = await screen.findByRole("table", { name: "Item U inferred observations and original witnesses" });
    expect(table.textContent).toContain("matched");expect(table.textContent).toContain("true");
    const u = answer.cases.find(value => value.case_id === "U");if (!u) throw new Error("Literal U missing");
    await user.click(within(table).getByRole("button", { name: "Inspect observation 1 of U" }));
    expect(props.onInspect.mock.calls.at(-1)?.[1]).toContain(u.observations[0].response_row_ids[0]);
    await user.click(screen.getByRole("button", { name: "Inspect complete item U" }));
    expect(props.onInspect).toHaveBeenLastCalledWith("U", u.record_row_ids);
    expect(u.activation_count).toBeNull();expect(u.truth).toBe("unknown");
  });
});
