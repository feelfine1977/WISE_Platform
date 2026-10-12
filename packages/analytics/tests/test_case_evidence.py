"""Opening one incident of a population: every raw record, in the declared order."""

import json

from wise_platform_analytics import (
    CaseEvidence,
    PolicySelection,
    PopulationAnswer,
    Refusal,
    open_case,
    open_population,
)

COLUMNS = (
    "incident_id",
    "source_event_id",
    "source_sequence",
    "activity",
    "timestamp_utc",
    "service",
    "assignment_group",
)

# Incident B is not contiguous in the source; three records have no activity label.
ROWS = (
    "B,b-1,1,Opened,2026-10-01T09:00:00Z,S,Desk",
    "A,a-1,1,Opened,2026-10-01T09:05:00Z,S,Unknown",
    "B,b-2,2,,2026-10-01T10:00:00Z,S,Desk",
    "C,c-1,1,,2026-10-01T10:00:00Z,T,",
    "A,a-2,2,Unknown,2026-10-01T11:00:00Z,S,",
    "B,b-3,3,,2026-10-01T11:30:00Z,S,Network",
    "B,b-4,4,Resolved,2026-10-01T12:00:00Z,S,Network",
)


def population_of(source: bytes, policies: PolicySelection) -> PopulationAnswer:
    answer = open_population(source, policies)
    assert isinstance(answer, PopulationAnswer), answer
    return answer


def evidence_of(source: bytes, policies: PolicySelection, case_id: str) -> CaseEvidence:
    population_id = population_of(source, policies).identities.population_id
    evidence = open_case(source, policies, population_id, case_id)
    assert isinstance(evidence, CaseEvidence), evidence
    return evidence


def cells(*values: str | None) -> dict[str, str | None]:
    return dict(zip(COLUMNS, values, strict=True))


def test_it_returns_every_raw_record_of_the_incident_and_no_other(csv_source, policies):
    evidence = evidence_of(csv_source(*ROWS), policies, "B")

    assert evidence.case_id == "B"
    assert evidence.raw_record_count == 4
    assert [record.cells for record in evidence.records] == [
        cells("B", "b-1", "1", "Opened", "2026-10-01T09:00:00Z", "S", "Desk"),
        cells("B", "b-2", "2", None, "2026-10-01T10:00:00Z", "S", "Desk"),
        cells("B", "b-3", "3", None, "2026-10-01T11:30:00Z", "S", "Network"),
        cells("B", "b-4", "4", "Resolved", "2026-10-01T12:00:00Z", "S", "Network"),
    ]
    assert [record.source_position for record in evidence.records] == [1, 3, 6, 7]


def test_every_incident_of_the_population_can_be_opened_and_together_they_hold_every_record(
    csv_source, policies
):
    source = csv_source(*ROWS)
    population = population_of(source, policies)

    positions = []
    for count in population.raw_record_counts:
        evidence = evidence_of(source, policies, count.incident_id)
        assert (
            evidence.raw_record_count == len(evidence.records) == count.raw_record_count
        )
        positions.extend(record.source_position for record in evidence.records)

    assert sorted(positions) == [1, 2, 3, 4, 5, 6, 7]


def test_records_without_a_label_stay_in_the_evidence_and_are_flagged_as_omitted(
    csv_source, policies
):
    evidence = evidence_of(csv_source(*ROWS), policies, "B")

    assert [record.omitted_from_mapped_sequence for record in evidence.records] == [
        False,
        True,
        True,
        False,
    ]
    assert evidence.omitted_record_count == 2


def test_a_missing_cell_is_none_and_never_empty_text_or_unknown(csv_source, policies):
    source = csv_source(*ROWS)

    missing = evidence_of(source, policies, "C").records[0]
    literal = evidence_of(source, policies, "A").records

    assert missing.cells["activity"] is None
    assert missing.cells["assignment_group"] is None
    assert missing.omitted_from_mapped_sequence is True
    assert literal[0].cells["assignment_group"] == "Unknown"
    assert literal[1].cells["activity"] == "Unknown"
    assert literal[1].cells["assignment_group"] is None
    assert [record.omitted_from_mapped_sequence for record in literal] == [False, False]


def test_records_sharing_a_timestamp_follow_the_sequence_and_then_the_source_position(
    csv_source, policies
):
    source = csv_source(
        "T,t-resolved,3,Resolved,2026-10-01T10:00:00Z,S,App",
        "T,t-gap,2,,2026-10-01T10:00:00Z,S,Desk",
        "T,t-assigned,4,Assigned,2026-10-01T10:00:00Z,S,App",
        "T,t-noted,3,Noted,2026-10-01T10:00:00Z,S,App",
        "T,t-opened,9,Opened,2026-10-01T09:00:00Z,S,Desk",
    )

    evidence = evidence_of(source, policies, "T")

    assert [record.row_id for record in evidence.records] == [
        "t-opened",
        "t-gap",
        "t-resolved",
        "t-noted",
        "t-assigned",
    ]
    assert [record.source_position for record in evidence.records] == [5, 2, 1, 4, 3]


def test_the_row_id_is_the_source_event_id_when_it_is_present_and_unique_in_the_source(
    csv_source, policies
):
    source = csv_source(
        "A,e-1,1,Opened,2026-10-01T09:00:00Z,S,Desk",
        "A,,2,Assigned,2026-10-01T10:00:00Z,S,Desk",
        "A,twice,3,Resolved,2026-10-01T11:00:00Z,S,Desk",
        "B,twice,1,Opened,2026-10-01T09:00:00Z,S,Desk",
        "B,e-2,2,Resolved,2026-10-01T10:00:00Z,S,Desk",
    )

    first = evidence_of(source, policies, "A").records
    second = evidence_of(source, policies, "B").records

    assert [
        (record.row_id, record.row_id_kind, record.source_position) for record in first
    ] == [
        ("e-1", "source_event_id", 1),
        ("source_position:2", "source_position", 2),
        ("source_position:3", "source_position", 3),
    ]
    assert [
        (record.row_id, record.row_id_kind, record.source_position) for record in second
    ] == [
        ("source_position:4", "source_position", 4),
        ("e-2", "source_event_id", 5),
    ]
    assert first[2].cells["source_event_id"] == "twice"
    assert first[1].cells["source_event_id"] is None


def test_row_ids_are_unique_in_a_source_even_when_an_event_id_imitates_a_position(
    csv_source, policies
):
    source = csv_source(
        "A,source_position:2,1,Opened,2026-10-01T09:00:00Z,S,Desk",
        "A,,2,Assigned,2026-10-01T10:00:00Z,S,Desk",
    )

    records = evidence_of(source, policies, "A").records

    assert [(record.row_id, record.row_id_kind) for record in records] == [
        ("source_position:1", "source_position"),
        ("source_position:2", "source_position"),
    ]


def test_columns_beyond_the_required_ones_are_part_of_the_evidence(
    csv_source, policies
):
    source = csv_source(
        "A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk,High,",
        "A,a-2,2,Resolved,2026-10-01T10:00:00Z,S,Desk,,by phone",
        header=",".join((*COLUMNS, "priority", "note")),
    )

    records = evidence_of(source, policies, "A").records

    assert list(records[0].cells) == [*COLUMNS, "priority", "note"]
    assert (records[0].cells["priority"], records[0].cells["note"]) == ("High", None)
    assert (records[1].cells["priority"], records[1].cells["note"]) == (
        None,
        "by phone",
    )


def test_a_byte_order_mark_and_windows_line_ends_do_not_change_the_evidence(
    csv_source, policies
):
    plain = evidence_of(csv_source(*ROWS), policies, "B")
    windows = evidence_of(csv_source(*ROWS, newline="\r\n", bom=True), policies, "B")

    assert windows.records == plain.records
    assert list(windows.records[0].cells) == list(COLUMNS)
    assert windows.records[-1].cells["assignment_group"] == "Network"
    assert windows.identities != plain.identities


def test_the_evidence_is_bound_to_the_population_it_was_opened_from(
    csv_source, policies
):
    source = csv_source(*ROWS)
    population = population_of(source, policies)

    evidence = evidence_of(source, policies, "A")

    assert evidence.identities == population.identities
    assert evidence.policies == population.policies


def test_a_population_identity_that_does_not_match_is_refused(csv_source, policies):
    source = csv_source(*ROWS)
    computed = population_of(source, policies).identities.population_id
    other_source = population_of(
        csv_source(*ROWS, newline="\r\n"), policies
    ).identities.population_id

    for supplied in (
        "",
        "pop_" + "0" * 64,
        other_source,
        computed.upper(),
        computed + " ",
    ):
        refusal = open_case(source, policies, supplied, "A")

        assert isinstance(refusal, Refusal), refusal
        assert refusal.code == "identity_mismatch"
        assert refusal.detail == {
            "identity": "population_id",
            "supplied": supplied,
            "computed": computed,
        }
        assert refusal.message


def test_a_case_that_is_not_in_the_population_is_refused(csv_source, policies):
    source = csv_source(*ROWS)
    population_id = population_of(source, policies).identities.population_id

    for case_id in ("Z", "b", "B ", "", "b-1"):
        refusal = open_case(source, policies, population_id, case_id)

        assert isinstance(refusal, Refusal), refusal
        assert refusal.code == "unknown_case"
        assert refusal.detail == {"case_id": case_id, "population_id": population_id}
        assert refusal.message


def test_the_population_identity_is_checked_before_the_case(csv_source, policies):
    refusal = open_case(csv_source(*ROWS), policies, "pop_elsewhere", "Z")

    assert isinstance(refusal, Refusal), refusal
    assert refusal.code == "identity_mismatch"


def test_a_malformed_source_or_an_unusable_selection_is_refused(csv_source, policies):
    source = csv_source(*ROWS)
    population_id = population_of(source, policies).identities.population_id

    malformed = open_case(
        csv_source("A,a-1,one,Opened,2026-10-01T09:00:00Z,S,Desk"),
        policies,
        population_id,
        "A",
    )
    unselected = open_case(
        source, PolicySelection.of(activity_projection="x.v1"), population_id, "A"
    )

    assert isinstance(malformed, Refusal) and malformed.code == "malformed_source"
    assert isinstance(unselected, Refusal) and unselected.code == "unknown_policy"


def test_the_evidence_is_plain_json_when_asked(csv_source, policies):
    evidence = evidence_of(csv_source(*ROWS), policies, "C")

    as_dict = evidence.to_dict()

    assert as_dict == {
        "kind": "case_evidence",
        "identities": evidence.identities.to_dict(),
        "policies": evidence.policies.to_dict(),
        "case_id": "C",
        "raw_record_count": 1,
        "omitted_record_count": 1,
        "records": [
            {
                "row_id": "c-1",
                "row_id_kind": "source_event_id",
                "source_position": 4,
                "cells": {
                    "incident_id": "C",
                    "source_event_id": "c-1",
                    "source_sequence": "1",
                    "activity": None,
                    "timestamp_utc": "2026-10-01T10:00:00Z",
                    "service": "T",
                    "assignment_group": None,
                },
                "omitted_from_mapped_sequence": True,
            }
        ],
    }
    assert json.loads(json.dumps(as_dict)) == as_dict
