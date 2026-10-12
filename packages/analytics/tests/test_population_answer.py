"""Opening the population of a source: which incidents, how many records, under which identities."""

import hashlib
import json

import pytest

from wise_platform_analytics import (
    PolicyChoice,
    PolicySelection,
    PopulationAnswer,
    Refusal,
    open_population,
)

ORDER = "incident.order.timestamp_sequence_source_position.v1"
ACTIVITY_PROJECTION = "incident.activity.omit_missing_retain_raw_gaps.v1"
MISSING_VALUE = "incident.missing_value.empty_cell_only.v1"

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


def opened(source: bytes, policies: PolicySelection) -> PopulationAnswer:
    answer = open_population(source, policies)
    assert isinstance(answer, PopulationAnswer), answer
    return answer


def test_it_counts_distinct_incidents_and_raw_records_exactly(csv_source, policies):
    answer = opened(csv_source(*ROWS), policies)

    assert answer.incident_count == 3
    assert answer.raw_record_count == 7


def test_membership_lists_each_incident_once_in_order_of_first_appearance(
    csv_source, policies
):
    answer = opened(csv_source(*ROWS), policies)

    assert answer.membership == ("B", "A", "C")
    assert answer.membership_order == "first_appearance_in_source"


def test_each_incident_has_its_raw_record_count_even_when_its_rows_are_apart(
    csv_source, policies
):
    answer = opened(csv_source(*ROWS), policies)

    assert [
        (count.incident_id, count.raw_record_count)
        for count in answer.raw_record_counts
    ] == [
        ("B", 4),
        ("A", 2),
        ("C", 1),
    ]
    assert (
        sum(count.raw_record_count for count in answer.raw_record_counts)
        == answer.raw_record_count
    )


def test_records_without_an_activity_label_are_counted_with_the_incidents_they_touch(
    csv_source, policies
):
    coverage = opened(csv_source(*ROWS), policies).omitted_label_coverage

    assert coverage.omitted_record_count == 3
    assert coverage.raw_record_count == 7
    assert coverage.affected_incident_count == 2
    assert coverage.incident_count == 3


def test_the_label_unknown_is_a_label_and_not_a_missing_one(csv_source, policies):
    answer = opened(
        csv_source(
            "A,a-1,1,Unknown,2026-10-01T09:00:00Z,S,Unknown",
            "B,b-1,1,unknown,2026-10-01T09:00:00Z,S,",
        ),
        policies,
    )

    assert answer.omitted_label_coverage.omitted_record_count == 0
    assert answer.omitted_label_coverage.affected_incident_count == 0


def test_incident_ids_are_exact_text(csv_source, policies):
    answer = opened(
        csv_source(
            "inc1,,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            "INC1,,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            "INC1 ,,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            "Unknown,,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            "inc1,,2,Resolved,2026-10-01T10:00:00Z,S,Desk",
        ),
        policies,
    )

    assert answer.membership == ("inc1", "INC1", "INC1 ", "Unknown")
    assert answer.raw_record_counts[0].raw_record_count == 2


def test_the_answer_names_the_policies_and_versions_it_was_computed_under(
    csv_source, policies
):
    answer = opened(csv_source(*ROWS), policies)

    assert answer.policies.order == PolicyChoice(ORDER)
    assert answer.policies.activity_projection == PolicyChoice(ACTIVITY_PROJECTION)
    assert answer.policies.missing_value == PolicyChoice(MISSING_VALUE)
    assert answer.identities.parser_version == "incident.event_history_csv.v1"
    assert answer.identities.implementation_version == "0.1.0"


def test_the_source_identity_is_the_sha256_of_the_given_bytes(csv_source, policies):
    source = csv_source(*ROWS)

    assert (
        opened(source, policies).identities.source_id
        == hashlib.sha256(source).hexdigest()
    )


def test_the_same_bytes_and_policies_give_the_same_answer_every_time(
    csv_source, policies
):
    first = opened(csv_source(*ROWS), policies)
    again = opened(
        csv_source(*ROWS),
        PolicySelection(
            {
                "activity_projection": PolicyChoice(ACTIVITY_PROJECTION),
                "order": PolicyChoice(ORDER),
            }
        ),
    )

    assert first == again
    assert first.identities == again.identities
    assert first.to_dict() == again.to_dict()


def test_a_byte_order_mark_and_windows_line_ends_change_the_identities_but_not_the_counts(
    csv_source, policies
):
    plain = opened(csv_source(*ROWS), policies)
    windows = opened(csv_source(*ROWS, newline="\r\n", bom=True), policies)

    assert windows.membership == plain.membership
    assert windows.raw_record_counts == plain.raw_record_counts
    assert windows.omitted_label_coverage == plain.omitted_label_coverage
    assert windows.identities.source_id != plain.identities.source_id
    assert windows.identities.preparation_id != plain.identities.preparation_id
    assert windows.identities.representation_id != plain.identities.representation_id
    assert windows.identities.case_dictionary_id != plain.identities.case_dictionary_id
    assert windows.identities.population_id != plain.identities.population_id


def test_one_changed_cell_changes_every_identity(csv_source, policies):
    first = opened(csv_source(*ROWS), policies)
    other = opened(
        csv_source(*ROWS[:-1], "B,b-4,4,Closed,2026-10-01T12:00:00Z,S,Network"),
        policies,
    )

    assert other.membership == first.membership
    assert set(other.identities.to_dict().items()) & set(
        first.identities.to_dict().items()
    ) == {
        ("parser_version", "incident.event_history_csv.v1"),
        ("implementation_version", "0.1.0"),
    }


def test_the_answer_is_plain_json_when_asked(csv_source, policies):
    answer = opened(csv_source(*ROWS), policies)

    as_dict = answer.to_dict()

    assert as_dict == {
        "kind": "population_answer",
        "identities": {
            "source_id": answer.identities.source_id,
            "preparation_id": answer.identities.preparation_id,
            "representation_id": answer.identities.representation_id,
            "case_dictionary_id": answer.identities.case_dictionary_id,
            "population_id": answer.identities.population_id,
            "parser_version": "incident.event_history_csv.v1",
            "implementation_version": "0.1.0",
        },
        "policies": {
            "order": {"policy_id": ORDER, "parameters": {}},
            "missing_value": {"policy_id": MISSING_VALUE, "parameters": {}},
            "activity_projection": {"policy_id": ACTIVITY_PROJECTION, "parameters": {}},
        },
        "incident_count": 3,
        "raw_record_count": 7,
        "membership_order": "first_appearance_in_source",
        "membership": ["B", "A", "C"],
        "raw_record_counts": [
            {"incident_id": "B", "raw_record_count": 4},
            {"incident_id": "A", "raw_record_count": 2},
            {"incident_id": "C", "raw_record_count": 1},
        ],
        "omitted_label_coverage": {
            "omitted_record_count": 3,
            "raw_record_count": 7,
            "affected_incident_count": 2,
            "incident_count": 3,
        },
    }
    assert json.loads(json.dumps(as_dict)) == as_dict


def test_a_malformed_source_is_refused_and_never_an_empty_population(
    csv_source, policies
):
    for source in (
        b"",
        csv_source(),
        csv_source(",x,1,Opened,2026-10-01T09:00:00Z,S,Desk"),
        b"\xff\xfe",
    ):
        refusal = open_population(source, policies)

        assert isinstance(refusal, Refusal), refusal
        assert refusal.code == "malformed_source"


def test_a_selection_that_cannot_be_applied_is_refused(csv_source):
    refusal = open_population(csv_source(*ROWS), PolicySelection.of(order=ORDER))

    assert isinstance(refusal, Refusal), refusal
    assert refusal.code == "missing_policy"
    assert refusal.detail["role"] == "activity_projection"


def test_a_source_that_is_not_bytes_is_a_programming_error(csv_source, policies):
    with pytest.raises(TypeError, match="source must be bytes"):
        open_population(csv_source(*ROWS).decode("utf-8"), policies)  # type: ignore[arg-type]


def test_the_selection_is_checked_before_the_source_is_read():
    refusal = open_population(
        b"", PolicySelection.of(order=ORDER, activity_projection="x.v1")
    )

    assert isinstance(refusal, Refusal), refusal
    assert refusal.code == "unknown_policy"
