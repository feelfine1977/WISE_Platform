import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CapacityNote, MEASURED_TIER } from "./CapacityNote";

it("says the measured tier, that larger files are not measured, the service's memory budget and that nothing is sampled (#29)", async () => {
  render(<CapacityNote checkHealth={async () => ({ status: "ok", stage: "foundation", version: "0.1.0", memory_budget_bytes: 10 * 1024 ** 3 })} />);
  const note = await screen.findByText(/, 10 GiB, is refused before it starts/);
  expect(note.textContent).toBe(
    `Measured: the incident journey with up to 50,000 incidents and 394,433 records with 3 context columns, on ${MEASURED_TIER.machine}: each step within 6 seconds ` +
      "and at most 0.8 GB of memory. Larger files are not measured. Work that would not fit the memory this service may use, 10 GiB, is refused before it starts, " +
      "with what to do. Every figure is exact: nothing is sampled.",
  );
});
