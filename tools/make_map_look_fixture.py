"""Write the invented log of tests/fixtures/map-look: 240 incidents over 36 activities, from a fixed seed.

Each incident starts at "Step 01" and walks forward one to three steps at a time until it passes "Step 36" or stops, so
the map has a main flow and many side paths, more than fit legibly at once. Phase is "Early" for steps 1-12, "Middle"
for 13-24 and "Late" for 25-36. Nothing here is read by product code; the file is written once and committed.

    python tools/make_map_look_fixture.py
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import random

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    chance = random.Random(71)
    rows = ["Ticket,Status,At,Seq,Phase"]
    start = datetime(2026, 9, 1, 8, tzinfo=timezone.utc)
    for incident in range(1, 241):
        at = start + timedelta(hours=incident * 3)
        step, seq = 1, 1
        while step <= 36:
            phase = "Early" if step <= 12 else "Middle" if step <= 24 else "Late"
            rows.append(f"M-{incident:03d},Step {step:02d},{at.strftime('%Y-%m-%dT%H:%M:%SZ')},{seq},{phase}")
            if chance.random() < 0.06:
                break
            step += chance.choice((1, 1, 1, 2, 3))
            at += timedelta(hours=chance.randint(1, 30))
            seq += 1
    folder = ROOT / "tests/fixtures/map-look"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "large.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
