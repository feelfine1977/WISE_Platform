"""Wire-compatible population and complete evidence over prepared CSV snapshots."""

from __future__ import annotations

from collections.abc import Mapping

from .mapping import ImportRefusal
from .preparation import PreparedData, PreparedRecord


def _coverage(rows: tuple[PreparedRecord, ...]) -> dict[str, int]:
    mapped = sum(row.activity is not None for row in rows)
    return {"raw_record_count": len(rows), "mapped_record_count": mapped, "omitted_activity_record_count": len(rows) - mapped}


def open_prepared_population(prepared: PreparedData) -> dict[str, object]:
    """Return analytical fields; the application supplies source metadata/envelope."""
    identified = tuple(row for row in prepared.records if row.case_id is not None)
    membership = sorted(prepared.histories)
    return {"identity": prepared.identity_dict(), "preparation": prepared.descriptor(),
            "population": {"case_ids": membership, "case_count": len(membership), "record_count": len(identified)},
            "coverage": _coverage(identified), "unassigned_record_count": len(prepared.records) - len(identified),
            "cases": [{"case_id": case, "record_count": len(prepared.histories[case]),
                       "mapped_record_count": sum(row.activity is not None for row in prepared.histories[case]),
                       "omitted_activity_record_count": sum(row.activity is None for row in prepared.histories[case]),
                       "sequence_evaluable": prepared.sequence_evaluable(case)} for case in membership]}


def open_prepared_case(prepared: PreparedData, identity: Mapping[str, object], case_id: str) -> dict[str, object] | ImportRefusal:
    """Require the whole population identity before returning complete raw records."""
    expected = prepared.identity_dict()
    if not isinstance(identity, Mapping) or dict(identity) != expected:
        return ImportRefusal("identity_mismatch", "The supplied identity does not match this prepared population.", "identity")
    if not isinstance(case_id, str) or case_id not in prepared.histories:
        return ImportRefusal("case_not_found", "This case is not in the prepared population.", "case_id")
    rows = prepared.histories[case_id]
    return {"identity": expected, "case_id": case_id, "coverage": _coverage(rows),
            "columns": [{"index": index, "name": name} for index, name in enumerate(prepared.columns)],
            "sequence_evaluable": prepared.sequence_evaluable(case_id), "records": [row.to_dict() for row in rows],
            "mapped_row_ids": [row.row_id for row in rows if row.activity is not None],
            "omitted_activity_row_ids": [row.row_id for row in rows if row.activity is None]}
