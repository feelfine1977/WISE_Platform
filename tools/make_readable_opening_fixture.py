"""Write the invented log of tests/fixtures/readable-opening: 600 incidents over 45 activities, from a fixed seed.

The log is shaped like a purchasing flow, with nothing of any company in it. Its activities have long names in families
that are shortened alike on a card ("Record goods receipt for the purchase order item at the central warehouse" and
"... at the regional warehouse"), loops (a cancelled receipt or invoice recorded again, a quantity changed after the
receipt, a payment block set and removed) and a Phase context column for stages. Each incident walks a main flow and
takes, at each step, a rare side path to another activity, so that the log has more distinct paths than a map can open on
legibly: the file holds more than 600 paths between activities. Nothing here is read by product code; the file and the
counts beside it are written once and committed.

    python tools/make_readable_opening_fixture.py
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import random

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / "tests/fixtures/readable-opening"

# The activities by phase. Families of long names share their start, so that cards shorten them alike.
PHASES: list[tuple[str, list[str]]] = [
    ("Requisition", [
        "SRM: Created", "SRM: Awaiting approval", "SRM: Complete", "SRM: Ordered", "SRM: Document completed",
        "SRM: In transfer to execution system", "SRM: Change was transmitted", "SRM: Transaction completed", "SRM: Incomplete", "SRM: Held",
        "Create purchase requisition item",
    ]),
    ("Order", [
        "Create purchase order item", "Receive order confirmation", "Update order confirmation", "Release purchase order", "Block purchase order item",
        "Delete purchase order item", "Reactivate purchase order item", "Change delivery indicator", "Change storage location",
        "Change approval for purchase order", "Change rejection indicator",
        "Change the quantity of the purchase order item before the goods receipt", "Change the quantity of the purchase order item after the goods receipt",
        "Change the price of the purchase order item before the invoice receipt", "Change the price of the purchase order item after the invoice receipt",
    ]),
    ("Receipt", [
        "Record goods receipt for the purchase order item at the central warehouse", "Record goods receipt for the purchase order item at the regional warehouse",
        "Record goods receipt for the purchase order item at the vendor site", "Record service entry sheet", "Cancel goods receipt",
    ]),
    ("Invoice", [
        "Vendor creates invoice", "Vendor creates debit memo", "Vendor creates credit memo",
        "Record invoice receipt for the purchase order item from the vendor portal", "Record invoice receipt for the purchase order item from the mailroom scan",
        "Record invoice receipt for the purchase order item from the electronic interchange", "Record subsequent invoice", "Cancel invoice receipt",
        "Change final invoice indicator", "Set payment block", "Remove payment block",
    ]),
    ("Payment", [
        "Clear the invoice of the purchase order item by payment run", "Clear the invoice of the purchase order item by manual payment",
        "Clear the invoice of the purchase order item by credit memo",
    ]),
]
ACTIVITIES = [name for _, names in PHASES for name in names]
PHASE_OF = {name: phase for phase, names in PHASES for name in names}

# The main flow, step by step: the choices at each step with their weights, and where a loop leads back to.
GOODS = ["Record goods receipt for the purchase order item at the central warehouse", "Record goods receipt for the purchase order item at the regional warehouse",
         "Record goods receipt for the purchase order item at the vendor site", "Record service entry sheet"]
INVOICES = ["Record invoice receipt for the purchase order item from the vendor portal", "Record invoice receipt for the purchase order item from the mailroom scan",
            "Record invoice receipt for the purchase order item from the electronic interchange"]
CLEARINGS = ["Clear the invoice of the purchase order item by payment run", "Clear the invoice of the purchase order item by manual payment",
             "Clear the invoice of the purchase order item by credit memo"]
VENDOR = ["Vendor creates invoice", "Vendor creates debit memo", "Vendor creates credit memo"]


def walk(chance: random.Random) -> list[str]:
    """One incident's activities in order: the main flow with its branches, loops and rare side paths."""
    steps: list[str] = []
    if chance.random() < 0.35:
        steps += ["SRM: Created", "SRM: Awaiting approval", "SRM: Complete", "SRM: Ordered"]
        if chance.random() < 0.3:
            steps += chance.sample(["SRM: Document completed", "SRM: In transfer to execution system", "SRM: Change was transmitted", "SRM: Held", "SRM: Incomplete"], 2)
        steps.append("SRM: Transaction completed")
    else:
        steps.append("Create purchase requisition item")
    steps.append("Create purchase order item")
    if chance.random() < 0.6:
        steps.append("Receive order confirmation")
        if chance.random() < 0.15:
            steps.append("Update order confirmation")
    if chance.random() < 0.25:
        steps.append(chance.choice(["Release purchase order", "Change delivery indicator", "Change storage location", "Change approval for purchase order"]))
    if chance.random() < 0.12:
        steps.append("Change the quantity of the purchase order item before the goods receipt")
    if chance.random() < 0.08:
        steps.append("Change the price of the purchase order item before the invoice receipt")
    goods = chance.choices(GOODS, weights=[55, 25, 12, 8])[0]
    steps.append(goods)
    # A cancelled receipt is recorded again: a loop back to the receipt.
    if chance.random() < 0.1:
        steps += ["Cancel goods receipt", goods]
    if chance.random() < 0.1:
        steps += ["Change the quantity of the purchase order item after the goods receipt", goods]
    if chance.random() < 0.5:
        steps.append(chance.choices(VENDOR, weights=[80, 12, 8])[0])
    invoice = chance.choices(INVOICES, weights=[60, 28, 12])[0]
    steps.append(invoice)
    if chance.random() < 0.08:
        steps += ["Cancel invoice receipt", invoice]
    if chance.random() < 0.06:
        steps += ["Change the price of the purchase order item after the invoice receipt", invoice]
    if chance.random() < 0.15:
        steps += ["Set payment block", "Remove payment block"]
        if chance.random() < 0.3:
            steps += ["Set payment block", "Remove payment block"]
    if chance.random() < 0.05:
        steps.append("Record subsequent invoice")
    if chance.random() < 0.1:
        steps.append("Change final invoice indicator")
    steps.append(chance.choices(CLEARINGS, weights=[80, 14, 6])[0])
    # Rare side paths: at a few steps the incident takes any other activity, so that the log has many rare paths.
    out: list[str] = []
    for step in steps:
        out.append(step)
        if chance.random() < 0.12:
            out.append(chance.choice([name for name in ACTIVITIES if name != step]))
    # A few incidents stop early, and a few are deleted or blocked.
    if chance.random() < 0.05:
        out = out[: chance.randint(2, len(out))]
    if chance.random() < 0.03:
        out.append(chance.choice(["Delete purchase order item", "Block purchase order item", "Reactivate purchase order item"]))
    return out


def main() -> None:
    chance = random.Random(65)
    rows = ["Item,Activity,At,Seq,Phase"]
    start = datetime(2026, 8, 3, 7, tzinfo=timezone.utc)
    pairs: set[tuple[str, str]] = set()
    seen: set[str] = set()
    first: dict[str, int] = {}
    loops: set[tuple[str, str]] = set()
    for incident in range(1, 601):
        at = start + timedelta(hours=incident * 2 + chance.randint(0, 5))
        steps = walk(chance)
        first[steps[0]] = first.get(steps[0], 0) + 1
        for seq, step in enumerate(steps, 1):
            seen.add(step)
            rows.append(f"P-{incident:04d},{step},{at.strftime('%Y-%m-%dT%H:%M:%SZ')},{seq},{PHASE_OF[step]}")
            at += timedelta(hours=chance.randint(1, 36))
        for a, b in zip(steps, steps[1:]):
            pairs.add((a, b))
        for a, b in zip(steps, steps[2:]):
            if a == b and steps[steps.index(a) + 1] != a:
                loops.add((a, steps[steps.index(a) + 1]))
    FOLDER.mkdir(parents=True, exist_ok=True)
    (FOLDER / "large.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")
    colliding = [
        ["Record goods receipt for the purchase order item at the central warehouse", "Record goods receipt for the purchase order item at the regional warehouse"],
        ["Record invoice receipt for the purchase order item from the vendor portal", "Record invoice receipt for the purchase order item from the mailroom scan"],
        ["Vendor creates invoice", "Vendor creates debit memo"],
    ]
    both_ways = sorted({(a, b) for a, b in pairs if (b, a) in pairs and a < b})
    expected = {
        "about": "Expectations for #65 (tools/qualify_readable_opening.py), by construction of tools/make_readable_opening_fixture.py (seed 65): "
                 "600 invented incidents over 45 activities of a purchasing flow with long names shortened alike, loops and a Phase context "
                 "column. The counts are by construction of the generator, not read from any answer. Never read by product code.",
        "file": "large.csv",
        "mapping": {"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": 3, "context_columns": [4]},
        "cutoff_utc": "2026-12-31T00:00:00Z",
        "incidents": 600,
        "activities": len(seen),
        "paths": len(pairs),
        "first_activity": max(first, key=lambda name: first[name]),
        "colliding": colliding,
        "loop": ["Record goods receipt for the purchase order item at the central warehouse", "Cancel goods receipt"],
        "paths_both_ways": len(both_ways),
        "phases": [phase for phase, _ in PHASES],
    }
    assert expected["activities"] == len(ACTIVITIES) and expected["paths"] >= 600, (expected["activities"], expected["paths"])
    assert all(pair in pairs for pair in [(expected["loop"][0], expected["loop"][1]), (expected["loop"][1], expected["loop"][0])])
    (FOLDER / "expected.json").write_text(json.dumps(expected, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"activities": expected["activities"], "paths": expected["paths"], "records": len(rows) - 1, "both_ways": len(both_ways)}))


if __name__ == "__main__":
    main()
