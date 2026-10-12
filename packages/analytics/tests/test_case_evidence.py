"""Opening one incident of a population: every raw record, in the declared order."""

import hashlib
import json
from dataclasses import replace
from datetime import datetime, timezone

import pytest
from supported_policies import selection_with

from wise_platform_analytics import (
    CaseEvidence,
    Coverage,
    Identities,
    PolicyChoice,
    PolicySelection,
    PopulationAnswer,
    Refusal,
    open_case,
    open_population,
)
from wise_platform_analytics.evidence import utc_text

COLUMNS = (
    "incident_id",
    "source_event_id",
    "source_sequence",
    "activity",
    "timestamp_utc",
    "service",
    "assignment_group",
)
UTC = timezone.utc

# B (kept) and A (removed) form the parent population; C, D and E are outside.
# B is not contiguous in the source and two of its records have no activity label.
ROWS = (
    "B,b-1,1,Opened,2026-10-01T09:00:00Z,S,Desk",
    "A,a-1,1,Opened,2026-10-01T09:05:00Z,S,Unknown",
    "B,b-2,2,,2026-10-01T10:00:00Z,S,Desk",
    "C,c-1,1,,2026-10-01T10:00:00Z,T,",
    "A,a-2,2,Unknown,2026-10-01T11:00:00Z,S,",
    "B,b-3,3,,2026-10-01T11:30:00Z,S,Network",
    "B,b-4,4,Resolved,2026-10-01T12:00:00Z,S,Network",
    "D,d-1,1,Assigned,2026-10-01T09:00:00Z,S,Desk",
    "E,e-1,1,Opened,2026-10-01T09:00:00Z,S,Desk",
    "E,e-2,2,Resolved,2026-10-01T10:00:00Z,T,Desk",
)


def population_of(source: bytes, policies: PolicySelection) -> PopulationAnswer:
    answer = open_population(source, policies)
    assert isinstance(answer, PopulationAnswer), answer
    return answer


def evidence_of(source: bytes, policies: PolicySelection, case_id: str) -> CaseEvidence:
    identities = population_of(source, policies).identities
    evidence = open_case(source, policies, identities, case_id)
    assert isinstance(evidence, CaseEvidence), evidence
    return evidence


def expected_row_id(source: bytes, position: int) -> str:
    """The row identity written out from the scheme: source digest and position."""
    source_id = "source.v1:sha256:" + hashlib.sha256(source).hexdigest()
    canonical = (
        '{"kind":"row","source_id":"' + source_id + '","source_position":' + str(position) + "}"
    ).encode("ascii")
    return "row.v1:sha256:" + hashlib.sha256(canonical).hexdigest()


def originals(*values: str) -> dict[str, str]:
    return dict(zip(COLUMNS, values, strict=True))


def test_it_returns_every_raw_record_of_the_incident_and_no_other(csv_source, policies):
    evidence = evidence_of(csv_source(*ROWS), policies, "B")

    assert evidence.case_id == "B"
    assert [record.original_values for record in evidence.records] == [
        originals("B", "b-1", "1", "Opened", "2026-10-01T09:00:00Z", "S", "Desk"),
        originals("B", "b-2", "2", "", "2026-10-01T10:00:00Z", "S", "Desk"),
        originals("B", "b-3", "3", "", "2026-10-01T11:30:00Z", "S", "Network"),
        originals("B", "b-4", "4", "Resolved", "2026-10-01T12:00:00Z", "S", "Network"),
    ]
    assert [record.source_position for record in evidence.records] == [0, 2, 5, 6]
    assert evidence.coverage == Coverage(4, 2, 2)


def test_each_record_carries_the_values_read_from_its_cells(csv_source, policies):
    records = evidence_of(csv_source(*ROWS), policies, "B").records

    assert [record.source_event_id for record in records] == ["b-1", "b-2", "b-3", "b-4"]
    assert [record.source_sequence for record in records] == [1, 2, 3, 4]
    assert [record.timestamp_utc for record in records] == [
        datetime(2026, 10, 1, 9, tzinfo=UTC),
        datetime(2026, 10, 1, 10, tzinfo=UTC),
        datetime(2026, 10, 1, 11, 30, tzinfo=UTC),
        datetime(2026, 10, 1, 12, tzinfo=UTC),
    ]
    assert [record.activity for record in records] == ["Opened", None, None, "Resolved"]
    assert [record.service for record in records] == ["S", "S", "S", "S"]
    assert [record.assignment_group for record in records] == [
        "Desk",
        "Desk",
        "Network",
        "Network",
    ]


def test_every_incident_of_the_parent_can_be_opened_and_together_they_hold_its_records(
    csv_source, policies
):
    source = csv_source(*ROWS)
    population = population_of(source, policies)

    positions = []
    for summary in population.cases:
        evidence = evidence_of(source, policies, summary.case_id)
        assert len(evidence.records) == summary.record_count
        assert evidence.coverage.mapped_record_count == summary.mapped_record_count
        positions.extend(record.source_position for record in evidence.records)

    assert sorted(positions) == [0, 1, 2, 4, 5, 6]


def test_records_without_a_label_stay_in_the_evidence_and_their_rows_are_named(
    csv_source, policies
):
    source = csv_source(*ROWS)
    evidence = evidence_of(source, policies, "B")

    assert [record.omitted_from_mapped_sequence for record in evidence.records] == [
        False,
        True,
        True,
        False,
    ]
    assert evidence.mapped_row_ids == (
        expected_row_id(source, 0),
        expected_row_id(source, 6),
    )
    assert evidence.omitted_activity_row_ids == (
        expected_row_id(source, 2),
        expected_row_id(source, 5),
    )
    assert [record.row_id for record in evidence.records] == [
        expected_row_id(source, position) for position in (0, 2, 5, 6)
    ]


def test_a_missing_value_is_none_and_never_empty_text_or_unknown(csv_source, policies):
    records = evidence_of(csv_source(*ROWS), policies, "A").records

    assert records[0].assignment_group == "Unknown"
    assert records[1].activity == "Unknown"
    assert records[1].assignment_group is None
    assert records[1].original_values["assignment_group"] == ""
    assert [record.omitted_from_mapped_sequence for record in records] == [False, False]


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

    assert [record.source_event_id for record in evidence.records] == [
        "t-opened",
        "t-gap",
        "t-resolved",
        "t-noted",
        "t-assigned",
    ]
    assert [record.source_position for record in evidence.records] == [4, 1, 0, 3, 2]
    assert evidence.mapped_row_ids == tuple(
        expected_row_id(source, position) for position in (4, 0, 3, 2)
    )


def test_row_ids_are_unique_in_a_source_even_when_event_ids_repeat(csv_source, policies):
    source = csv_source(
        "A,twice,1,Opened,2026-10-01T09:00:00Z,S,Desk",
        "A,twice,2,Assigned,2026-10-01T10:00:00Z,S,Desk",
    )

    records = evidence_of(source, policies, "A").records

    assert [record.source_event_id for record in records] == ["twice", "twice"]
    assert [record.row_id for record in records] == [
        expected_row_id(source, 0),
        expected_row_id(source, 1),
    ]


def test_columns_beyond_the_required_ones_are_part_of_the_original_values(
    csv_source, policies
):
    source = csv_source(
        "A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk,High,",
        "A,a-2,2,Resolved,2026-10-01T10:00:00Z,S,Desk,,by phone",
        header=",".join((*COLUMNS, "priority", "note")),
    )

    records = evidence_of(source, policies, "A").records

    assert list(records[0].original_values) == [*COLUMNS, "priority", "note"]
    assert (records[0].original_values["priority"], records[0].original_values["note"]) == ("High", "")
    assert (records[1].original_values["priority"], records[1].original_values["note"]) == ("", "by phone")


def test_a_byte_order_mark_and_windows_line_ends_change_only_the_identities(
    csv_source, policies
):
    plain = evidence_of(csv_source(*ROWS), policies, "B")
    windows = evidence_of(csv_source(*ROWS, newline="\r\n", bom=True), policies, "B")

    assert [replace(record, row_id="") for record in windows.records] == [
        replace(record, row_id="") for record in plain.records
    ]
    assert list(windows.records[0].original_values) == list(COLUMNS)
    assert windows.identities != plain.identities
    assert windows.records[0].row_id != plain.records[0].row_id


def test_the_evidence_is_bound_to_the_population_it_was_opened_from(
    csv_source, policies
):
    source = csv_source(*ROWS)
    population = population_of(source, policies)

    evidence = evidence_of(source, policies, "A")

    assert evidence.identities == population.identities
    assert evidence.policies == population.policies


@pytest.mark.parametrize(
    "field",
    [
        "source_id",
        "preparation_id",
        "representation_id",
        "case_dictionary_id",
        "population_id",
        "implementation_version",
    ],
)
def test_every_identity_that_does_not_match_is_refused_by_name(
    csv_source, policies, field
):
    source = csv_source(*ROWS)
    computed = population_of(source, policies).identities
    supplied = replace(computed, **{field: getattr(computed, field) + "0"})

    refusal = open_case(source, policies, supplied, "A")

    assert isinstance(refusal, Refusal), refusal
    assert refusal.code == "identity_mismatch"
    assert refusal.detail == {
        "identity": field,
        "supplied": getattr(supplied, field),
        "computed": getattr(computed, field),
    }
    assert refusal.message


def test_identities_of_the_same_source_under_another_parent_are_refused(
    csv_source, policies
):
    source = csv_source(*ROWS)
    computed = population_of(source, policies).identities
    other = population_of(
        csv_source(*ROWS[:-1], "E,e-2,2,Resolved,2026-10-01T10:00:00Z,S,Desk"), policies
    ).identities

    refusal = open_case(source, policies, replace(computed, population_id=other.population_id), "A")

    assert isinstance(refusal, Refusal) and refusal.code == "identity_mismatch"
    assert refusal.detail["identity"] == "population_id"


@pytest.mark.parametrize("case_id", ["Z", "b", "B ", "", "b-1"])
def test_a_case_that_is_not_in_the_source_is_refused(csv_source, policies, case_id):
    source = csv_source(*ROWS)
    identities = population_of(source, policies).identities

    refusal = open_case(source, policies, identities, case_id)

    assert isinstance(refusal, Refusal), refusal
    assert refusal.code == "unknown_case"
    assert refusal.detail == {"case_id": case_id, "population_id": identities.population_id}
    assert refusal.message


@pytest.mark.parametrize("case_id", ["C", "D", "E"])
def test_a_case_outside_the_parent_population_is_refused(csv_source, policies, case_id):
    source = csv_source(*ROWS)
    identities = population_of(source, policies).identities

    refusal = open_case(source, policies, identities, case_id)

    assert isinstance(refusal, Refusal), refusal
    assert refusal.code == "case_not_in_population"
    assert refusal.detail == {"case_id": case_id, "population_id": identities.population_id}
    assert case_id in refusal.message


def test_the_identities_are_checked_before_the_case(csv_source, policies):
    source = csv_source(*ROWS)
    identities = population_of(source, policies).identities

    refusal = open_case(source, policies, replace(identities, population_id="other"), "Z")

    assert isinstance(refusal, Refusal), refusal
    assert refusal.code == "identity_mismatch"


def test_a_malformed_source_or_an_unusable_selection_is_refused(csv_source, policies):
    source = csv_source(*ROWS)
    identities = population_of(source, policies).identities

    malformed = open_case(
        csv_source("A,a-1,one,Opened,2026-10-01T09:00:00Z,S,Desk"),
        policies,
        identities,
        "A",
    )
    unselected = open_case(
        source, selection_with(activity_projection=PolicyChoice("x.v1")), identities, "A"
    )

    assert isinstance(malformed, Refusal) and malformed.code == "malformed_source"
    assert isinstance(unselected, Refusal) and unselected.code == "unknown_policy"


def test_utc_instants_are_written_with_a_z_and_microseconds_only_when_present():
    assert utc_text(datetime(2026, 10, 1, 9, tzinfo=UTC)) == "2026-10-01T09:00:00Z"
    assert (
        utc_text(datetime(2026, 10, 1, 9, 0, 0, 500_000, tzinfo=UTC))
        == "2026-10-01T09:00:00.500000Z"
    )
    assert utc_text(datetime(1, 1, 1, tzinfo=UTC)) == "0001-01-01T00:00:00Z"


def test_the_evidence_is_plain_json_when_asked(csv_source, policies):
    source = csv_source(*ROWS)
    evidence = evidence_of(source, policies, "A")

    as_dict = evidence.to_dict()

    assert as_dict == {
        "kind": "case_evidence",
        "identities": evidence.identities.to_dict(),
        "policies": evidence.policies.to_dict(),
        "case_id": "A",
        "coverage": {
            "raw_record_count": 2,
            "mapped_record_count": 2,
            "omitted_activity_record_count": 0,
        },
        "records": [
            {
                "row_id": expected_row_id(source, 1),
                "source_position": 1,
                "source_event_id": "a-1",
                "source_sequence": 1,
                "timestamp_utc": "2026-10-01T09:05:00Z",
                "activity": "Opened",
                "service": "S",
                "assignment_group": "Unknown",
                "original_values": originals(
                    "A", "a-1", "1", "Opened", "2026-10-01T09:05:00Z", "S", "Unknown"
                ),
                "omitted_from_mapped_sequence": False,
            },
            {
                "row_id": expected_row_id(source, 4),
                "source_position": 4,
                "source_event_id": "a-2",
                "source_sequence": 2,
                "timestamp_utc": "2026-10-01T11:00:00Z",
                "activity": "Unknown",
                "service": "S",
                "assignment_group": None,
                "original_values": originals(
                    "A", "a-2", "2", "Unknown", "2026-10-01T11:00:00Z", "S", ""
                ),
                "omitted_from_mapped_sequence": False,
            },
        ],
        "mapped_row_ids": [expected_row_id(source, 1), expected_row_id(source, 4)],
        "omitted_activity_row_ids": [],
    }
    assert json.loads(json.dumps(as_dict)) == as_dict
    assert isinstance(evidence.identities, Identities)
