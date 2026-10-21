import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Bpic19Scoring, type Bpic19ScoringSubject } from "./Bpic19Scoring";
import { bpic19Contract, type Bpic19Client } from "./scoring-client";
import type { Bpic19ScoreAnswer } from "./scoring-types";
import fixture from "./scoring-fixtures/historical-corrected-f29.json";

// The service's own answer for #127's F29 literal under the reviewed singular payment-term correction (Finance view).
function corrected(): Bpic19ScoreAnswer {
  const value: unknown = structuredClone(fixture);
  if (!bpic19Contract.answer(value)) throw new Error("The corrected historical fixture must satisfy the contract.");
  return value;
}
const base = corrected();
const roles = base.definition && typeof base.definition === "object" ? (base.definition as { roles: Bpic19ScoringSubject["roles"] }).roles : {};
const subject: Bpic19ScoringSubject = { workspace_id: base.workspace_id, base_identity: base.base_identity, named_population: base.named_population, roles };

describe("#127 the reviewed historical correction", () => {
  it("is chosen explicitly, marked in the definitions and sent as its own setting; the native binding shows after the run", async () => {
    const client: Bpic19Client = { read: vi.fn(), associate: vi.fn(), review: vi.fn(),
      score: vi.fn<Bpic19Client["score"]>(async request => ({ ok: true, answer: { ...corrected(), request_id: request.request_id, query_revision: request.query_revision } })) };
    render(<Bpic19Scoring subject={subject} client={client} revision={4} />);
    fireEvent.change(screen.getByLabelText("Reference profile"), { target: { value: "historical" } });
    expect(screen.getAllByText("Bound when the run is reviewed").length).toBe(29);
    const correction = screen.getByRole("checkbox", { name: /Corrected singular Change payment term selector/ });
    expect((correction as HTMLInputElement).checked).toBe(false);
    fireEvent.click(correction);
    expect(screen.getByText(/Reviewed correction: selects the singular source label Change payment term; the frozen catalogue keeps Change Payment Terms\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run analysis" }));
    await waitFor(() => expect(client.score).toHaveBeenCalledTimes(1));
    expect(vi.mocked(client.score).mock.calls[0][0].settings).toEqual(expect.objectContaining({ profile: "historical", view: "Finance", mode: "layer_balanced",
      historical_corrections: ["singular_change_payment_term"] }));
    await screen.findByText("Change payment term · historical_slug_v1");
    expect(screen.queryByText(/Settings changed/)).toBeNull();
  });

  it("restores the correction from a saved run without calling it changed", () => {
    render(<Bpic19Scoring subject={subject} client={{ read: vi.fn(), score: vi.fn() }} initialRun={corrected()} revision={4} />);
    expect((screen.getByRole("checkbox", { name: /Corrected singular Change payment term selector/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Change payment term · historical_slug_v1")).toBeTruthy();
    expect(screen.queryByText(/Settings changed/)).toBeNull();
  });
});
