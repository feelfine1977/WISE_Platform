"""Opening the populations of a source: which incidents, how many records, under which identities."""

import hashlib
import json

import pytest
from supported_policies import SUPPORTED_CHOICES, selection_with

from wise_platform_analytics import (
    CaseSummary,
    Coverage,
    PolicyChoice,
    PolicySelection,
    PopulationAnswer,
    PopulationSupport,
    Refusal,
    open_population,
)

# B and A have every record in service S and an Opened record: they form the
# parent population. B has a recorded Resolved and is kept; A has none (its
# label "Unknown" is not "Resolved") and is removed. C has service T and no
# Opened, D has no Opened, and one record of E has service T: those three are
# outside. B is not contiguous and two of its records have no activity label.
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


def opened(source: bytes, policies: PolicySelection) -> PopulationAnswer:
    answer = open_population(source, policies)
    assert isinstance(answer, PopulationAnswer), answer
    return answer


def test_the_base_population_is_every_incident_of_the_source(csv_source, policies):
    answer = opened(csv_source(*ROWS), policies)

    assert answer.base == PopulationSupport(("B", "A", "C", "D", "E"), 5, 10)


def test_the_parent_population_takes_whole_incidents_and_the_rest_is_outside(
    csv_source, policies
):
    answer = opened(csv_source(*ROWS), policies)

    assert answer.parent == PopulationSupport(("B", "A"), 2, 6)
    assert answer.outside == PopulationSupport(("C", "D", "E"), 3, 4)


def test_the_predicate_splits_the_parent_into_kept_and_removed(csv_source, policies):
    answer = opened(csv_source(*ROWS), policies)

    assert answer.kept == PopulationSupport(("B",), 1, 4)
    assert answer.removed == PopulationSupport(("A",), 1, 2)
    assert answer.unevaluable == PopulationSupport((), 0, 0)


def test_coverage_and_case_summaries_describe_the_parent_population(
    csv_source, policies
):
    answer = opened(csv_source(*ROWS), policies)

    assert answer.coverage == Coverage(
        raw_record_count=6, mapped_record_count=4, omitted_activity_record_count=2
    )
    assert answer.cases == (
        CaseSummary("B", 4, 2, 2, "kept"),
        CaseSummary("A", 2, 2, 0, "removed"),
    )


@pytest.mark.parametrize(
    ("rows", "side"),
    [
        (("X,x-1,1,Opened,2026-10-01T09:00:00Z,S,", "X,x-2,2,,2026-10-01T10:00:00Z,S,"), "removed"),
        (("X,x-1,1,Opened,2026-10-01T09:00:00Z,S,", "X,x-2,2,resolved,2026-10-01T10:00:00Z,S,"), "removed"),
        (("X,x-1,1,Opened,2026-10-01T09:00:00Z,S,", "X,x-2,2,Resolved ,2026-10-01T10:00:00Z,S,"), "removed"),
        (("X,x-1,1,Resolved,2026-10-01T09:00:00Z,S,", "X,x-2,2,Opened,2026-10-01T10:00:00Z,S,"), "kept"),
        (("X,x-1,1,Opened,2026-10-01T09:00:00Z,S,", "X,x-2,2,Resolved,2026-10-01T09:00:00Z,S,", "X,x-3,3,Reopened,2026-10-01T11:00:00Z,S,"), "kept"),
    ],
)
def test_only_a_recorded_resolved_label_keeps_an_incident(csv_source, policies, rows, side):
    answer = opened(csv_source(*rows), policies)

    assert answer.parent.case_ids == ("X",)
    assert answer.cases[0].partition == side
    assert answer.unevaluable.case_count == 0


@pytest.mark.parametrize(
    "rows",
    [
        ("X,x-1,1,Opened,2026-10-01T09:00:00Z,s,",),
        ("X,x-1,1,Opened,2026-10-01T09:00:00Z,S ,",),
        ("X,x-1,1,opened,2026-10-01T09:00:00Z,S,",),
        ("X,x-1,1,,2026-10-01T09:00:00Z,S,", "X,x-2,2,Resolved,2026-10-01T10:00:00Z,S,"),
        ("X,x-1,1,Opened,2026-10-01T09:00:00Z,S,", "X,x-2,2,Closed,2026-10-02T09:00:00Z,T,"),
    ],
)
def test_the_parent_needs_service_s_on_every_record_and_an_opened_label(
    csv_source, policies, rows
):
    answer = opened(csv_source(*rows), policies)

    assert answer.parent == PopulationSupport((), 0, 0)
    assert answer.outside.case_ids == ("X",)


def test_an_empty_parent_population_is_an_answer_with_zero_counts(csv_source, policies):
    answer = opened(csv_source("X,x-1,1,Opened,2026-10-01T09:00:00Z,T,"), policies)

    assert answer.parent.case_count == answer.kept.case_count == 0
    assert answer.coverage == Coverage(0, 0, 0)
    assert answer.cases == ()


def test_the_label_unknown_is_a_label_and_not_a_missing_one(csv_source, policies):
    answer = opened(
        csv_source(
            "A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Unknown",
            "A,a-2,2,Unknown,2026-10-01T10:00:00Z,S,",
        ),
        policies,
    )

    assert answer.coverage.omitted_activity_record_count == 0
    assert answer.cases[0].mapped_record_count == 2


def test_incident_ids_are_exact_text(csv_source, policies):
    answer = opened(
        csv_source(
            "inc1,e1,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            "INC1,e2,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            "INC1 ,e3,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            "Unknown,e4,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            "inc1,e5,2,Resolved,2026-10-01T10:00:00Z,S,Desk",
        ),
        policies,
    )

    assert answer.base.case_ids == ("inc1", "INC1", "INC1 ", "Unknown")
    assert answer.kept.case_ids == ("inc1",)
    assert answer.cases[0].record_count == 2


def test_the_answer_names_every_policy_it_was_computed_under(csv_source, policies):
    answer = opened(csv_source(*ROWS), policies)

    assert answer.policies.by_role() == SUPPORTED_CHOICES
    assert answer.identities.implementation_version == "0.1.0"
    assert answer.columns == (
        "incident_id",
        "source_event_id",
        "source_sequence",
        "activity",
        "timestamp_utc",
        "service",
        "assignment_group",
    )


def test_the_source_identity_is_the_sha256_of_the_given_bytes(csv_source, policies):
    source = csv_source(*ROWS)

    assert opened(source, policies).identities.source_id == (
        "source.v1:sha256:" + hashlib.sha256(source).hexdigest()
    )


def test_the_same_bytes_and_policies_give_the_same_answer_every_time(
    csv_source, policies
):
    first = opened(csv_source(*ROWS), policies)
    again = opened(
        csv_source(*ROWS),
        PolicySelection(dict(reversed(list(SUPPORTED_CHOICES.items())))),
    )

    assert first == again
    assert first.to_dict() == again.to_dict()


def test_a_byte_order_mark_and_windows_line_ends_change_the_identities_but_not_the_counts(
    csv_source, policies
):
    plain = opened(csv_source(*ROWS), policies)
    windows = opened(csv_source(*ROWS, newline="\r\n", bom=True), policies)

    for name in ("base", "parent", "kept", "removed", "unevaluable", "outside"):
        assert getattr(windows, name) == getattr(plain, name)
    assert windows.cases == plain.cases
    assert windows.coverage == plain.coverage
    differing = {
        name
        for name, value in windows.identities.to_dict().items()
        if value != plain.identities.to_dict()[name]
    }
    assert differing == {
        "source_id",
        "preparation_id",
        "representation_id",
        "case_dictionary_id",
        "population_id",
    }


def test_a_change_of_membership_changes_the_population_identity(csv_source, policies):
    first = opened(csv_source(*ROWS), policies)
    # The same incidents, but E now has service S on both records and joins the parent.
    other = opened(
        csv_source(*ROWS[:-1], "E,e-2,2,Resolved,2026-10-01T10:00:00Z,S,Desk"), policies
    )

    assert other.parent.case_ids == ("B", "A", "E")
    assert other.identities.population_id != first.identities.population_id


def test_the_answer_is_plain_json_when_asked(csv_source, policies):
    answer = opened(csv_source(*ROWS), policies)

    as_dict = answer.to_dict()

    assert as_dict == {
        "kind": "population_answer",
        "identities": answer.identities.to_dict(),
        "policies": answer.policies.to_dict(),
        "columns": list(answer.columns),
        "membership_order": "first_appearance_in_source",
        "populations": {
            "base": {"case_ids": ["B", "A", "C", "D", "E"], "case_count": 5, "record_count": 10},
            "parent": {"case_ids": ["B", "A"], "case_count": 2, "record_count": 6},
            "kept": {"case_ids": ["B"], "case_count": 1, "record_count": 4},
            "removed": {"case_ids": ["A"], "case_count": 1, "record_count": 2},
            "unevaluable": {"case_ids": [], "case_count": 0, "record_count": 0},
            "outside": {"case_ids": ["C", "D", "E"], "case_count": 3, "record_count": 4},
        },
        "coverage": {
            "raw_record_count": 6,
            "mapped_record_count": 4,
            "omitted_activity_record_count": 2,
        },
        "cases": [
            {
                "case_id": "B",
                "record_count": 4,
                "mapped_record_count": 2,
                "omitted_activity_record_count": 2,
                "partition": "kept",
            },
            {
                "case_id": "A",
                "record_count": 2,
                "mapped_record_count": 2,
                "omitted_activity_record_count": 0,
                "partition": "removed",
            },
        ],
    }
    assert json.loads(json.dumps(as_dict)) == as_dict


def test_a_malformed_source_is_refused_and_never_an_empty_population(
    csv_source, policies
):
    for source in (
        b"",
        csv_source(),
        csv_source(",x,1,Opened,2026-10-01T09:00:00Z,S,Desk"),
        csv_source("A,a-1,-1,Opened,2026-10-01T09:00:00Z,S,Desk"),
        csv_source("A,a-1,1,Opened,2026-10-01T09:00:00.1234567Z,S,Desk"),
        b"\xff\xfe",
    ):
        refusal = open_population(source, policies)

        assert isinstance(refusal, Refusal), refusal
        assert refusal.code == "malformed_source"


def test_a_selection_that_cannot_be_applied_is_refused(csv_source):
    refusal = open_population(csv_source(*ROWS), selection_with(predicate=None))

    assert isinstance(refusal, Refusal), refusal
    assert refusal.code == "missing_policy"
    assert refusal.detail["role"] == "predicate"


def test_a_source_that_is_not_bytes_is_a_programming_error(csv_source, policies):
    with pytest.raises(TypeError, match="source must be bytes"):
        open_population(csv_source(*ROWS).decode("utf-8"), policies)  # type: ignore[arg-type]


def test_the_selection_is_checked_before_the_source_is_read():
    refusal = open_population(b"", selection_with(parent=PolicyChoice("x.v1")))

    assert isinstance(refusal, Refusal), refusal
    assert refusal.code == "unknown_policy"
