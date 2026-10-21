"""The synthetic examples the application offers before any import.

Each example is an event-history CSV shipped inside this package. Its bytes
are read as they are, and its label says that it is synthetic. A CSV does not
record when it was observed, so the catalog declares the snapshot cutoff of
each example beside its label.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

PACKAGED_EXAMPLES = Path(__file__).parent / "examples"


@dataclass(frozen=True)
class Example:
    """One synthetic example: its id, its label and when it was observed."""

    example_id: str
    label: str
    snapshot_cutoff_utc: datetime


_CUTOFF = datetime(2026, 10, 2, tzinfo=timezone.utc)

CATALOG: Mapping[str, Example] = {
    example.example_id: example
    for example in (
        Example("S0", "Synthetic example S0: fictional IT cases", _CUTOFF),
        Example("S1", "Synthetic example S1: fictional IT cases, one reopened", _CUTOFF),
        Example(
            "S2",
            "Synthetic example S2: fictional IT cases with missing activity labels "
            "and equal timestamps",
            _CUTOFF,
        ),
        Example(
            "S3",
            "Synthetic example S3: a literal Unknown assignment group beside a missing one",
            _CUTOFF,
        ),
    )
}


def read_example(examples_dir: Path, example_id: str) -> bytes | None:
    """Return the bytes of a catalogued example, or ``None`` when they cannot be read.

    An id that is not in the catalog is a programming error and raises
    ``KeyError``; the boundary admits only catalogued ids.
    """
    example = CATALOG[example_id]
    try:
        return (examples_dir / f"{example.example_id}.csv").read_bytes()
    except OSError:
        return None
