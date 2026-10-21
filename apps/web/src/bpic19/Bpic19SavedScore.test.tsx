import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Bpic19SavedScore } from "./Bpic19SavedScore";
import { bpic19Contract, type Bpic19Client, type Bpic19Outcome } from "./scoring-client";
import fixture from "./scoring-fixtures/native-two-items.json";

function answer() {
  const value: unknown = structuredClone(fixture);
  if (!bpic19Contract.answer(value)) throw new Error("The native fixture must satisfy the contract.");
  return value;
}
const base = answer();
const subject = { workspace_id: base.workspace_id, base_identity: base.base_identity,
  named_population: base.named_population, roles: { item_category: 3, resource: 5, net_worth: 7 } };

describe("reopening a saved purchasing assessment", () => {
  it("reads the frozen run and displays it without evaluating another norm", async () => {
    const client: Bpic19Client = { score: vi.fn(), read: vi.fn<Bpic19Client["read"]>(async () => ({ ok: true, answer: answer() })) };
    const reviewed = vi.fn();
    render(<Bpic19SavedScore subject={subject} savedRunId={base.run_id} client={client} onReviewed={reviewed} />);
    await screen.findByText(/2 of 2 items scored/);
    expect(client.score).not.toHaveBeenCalled();
    expect(client.read).toHaveBeenCalledWith(expect.objectContaining({ run_id: base.run_id, case_offset: 0 }), expect.any(AbortSignal));
    expect(reviewed).toHaveBeenCalledTimes(1);
  });
  it("fences a late saved answer when the source population changes", async () => {
    let resolve: ((value: Bpic19Outcome) => void) | undefined;
    const client: Bpic19Client = { score: vi.fn(), read: vi.fn<Bpic19Client["read"]>(() => new Promise<Bpic19Outcome>(done => { resolve = done; })) };
    const reviewed = vi.fn();
    const { rerender } = render(<Bpic19SavedScore subject={subject} savedRunId={base.run_id} client={client} onReviewed={reviewed} />);
    const old = resolve;
    rerender(<Bpic19SavedScore subject={{ ...subject, named_population: { ...subject.named_population,
      identity: { ...subject.named_population.identity, population_id: `population.v1:sha256:${"c".repeat(64)}` } } }} savedRunId={base.run_id} client={client} onReviewed={reviewed} />);
    await act(async () => old?.({ ok: true, answer: answer() }));
    expect(screen.queryByText(/2 of 2 items scored/)).toBeNull();
    expect(reviewed).not.toHaveBeenCalled();
    await act(async () => resolve?.({ ok: true, answer: answer() }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/another population/));
  });
});
