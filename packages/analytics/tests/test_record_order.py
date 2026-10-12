"""The declared order of records and the activity projection applied to them."""

from wise_platform_analytics.ordering import order_records
from wise_platform_analytics.parsing import ParsedSource, parse_source
from wise_platform_analytics.policies import REGISTRY, PolicyChoice
from wise_platform_analytics.projection import omitted_from_mapped_sequence
from wise_platform_analytics.selection import in_parent, predicate_holds

ORDER = PolicyChoice("incident.order.timestamp_sequence_source_position.v1")
PROJECTION = PolicyChoice("incident.activity.omit_missing_retain_raw_gaps.v1")
# Roles whose policy is applied without a rule of its own here: the parser
# implements the missing values, and no answer of this version uses the others.
APPLIED_WITHOUT_RULE = {
    "missing_values",
    "comparison",
    "context_projection",
    "clock",
    "nullable_measure",
}


def records_of(source: bytes):
    parsed = parse_source(source)
    assert isinstance(parsed, ParsedSource), parsed
    return parsed.records


def ordered_event_ids(source: bytes) -> list[str | None]:
    return [
        record.source_event_id for record in order_records(records_of(source), ORDER)
    ]


def test_records_are_ordered_by_timestamp_before_anything_else(csv_source):
    source = csv_source(
        "A,late,1,Resolved,2026-10-01T12:00:00Z,S,Desk",
        "A,early,9,Opened,2026-10-01T09:00:00Z,S,Desk",
        "A,half-past,5,Assigned,2026-10-01T10:00:00.5Z,S,Desk",
        "A,on-the-hour,7,Assigned,2026-10-01T10:00:00Z,S,Desk",
    )

    assert ordered_event_ids(source) == ["early", "on-the-hour", "half-past", "late"]


def test_equal_timestamps_are_ordered_by_sequence_as_a_number(csv_source):
    source = csv_source(
        "A,ten,10,Assigned,2026-10-01T10:00:00Z,S,Desk",
        "A,nine,9,Assigned,2026-10-01T10:00:00Z,S,Desk",
        "A,zero,0,Assigned,2026-10-01T10:00:00Z,S,Desk",
        "A,two,02,Assigned,2026-10-01T10:00:00Z,S,Desk",
    )

    assert ordered_event_ids(source) == ["zero", "two", "nine", "ten"]


def test_equal_timestamps_and_sequences_are_ordered_by_position_in_the_source(
    csv_source,
):
    source = csv_source(
        "A,first,1,Zebra,2026-10-01T10:00:00Z,S,Desk",
        "A,second,1,Apple,2026-10-01T10:00:00Z,S,Desk",
        "A,third,1,,2026-10-01T10:00:00Z,S,Desk",
        "A,fourth,1,Apple,2026-10-01T10:00:00Z,S,Desk",
    )

    assert ordered_event_ids(source) == ["first", "second", "third", "fourth"]


def test_one_instant_written_in_two_ways_is_a_tie(csv_source):
    source = csv_source(
        "A,second,2,Assigned,2026-10-01T10:00:00.000Z,S,Desk",
        "A,first,1,Assigned,2026-10-01T10:00:00Z,S,Desk",
    )

    assert ordered_event_ids(source) == ["first", "second"]


def test_ordering_returns_the_same_records_and_leaves_its_input_alone(csv_source):
    records = records_of(
        csv_source(
            "A,b,2,Resolved,2026-10-01T12:00:00Z,S,Desk",
            "A,a,1,Opened,2026-10-01T09:00:00Z,S,Desk",
        )
    )

    ordered = order_records(records, ORDER)

    assert ordered == (records[1], records[0])
    assert [record.source_event_id for record in records] == ["b", "a"]


def test_a_record_without_a_label_is_omitted_from_the_mapped_sequence(csv_source):
    records = records_of(
        csv_source(
            "A,a,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            "A,b,2,,2026-10-01T10:00:00Z,S,Desk",
            "A,c,3,Unknown,2026-10-01T11:00:00Z,S,Desk",
            'A,d,4," ",2026-10-01T12:00:00Z,S,Desk',
        )
    )

    assert [omitted_from_mapped_sequence(record, PROJECTION) for record in records] == [
        False,
        True,
        False,
        False,
    ]


def test_every_registered_policy_has_its_rule():
    record = records_of(
        b"incident_id,source_event_id,source_sequence,activity,timestamp_utc,service,assignment_group\n"
        b"A,a,1,Opened,2026-10-01T09:00:00Z,S,Desk\n"
    )[0]
    for definition in REGISTRY:
        choice = PolicyChoice(definition.policy_id, definition.parameters)
        if definition.role == "order":
            assert order_records((), choice) == ()
        elif definition.role == "activity_projection":
            assert omitted_from_mapped_sequence(record, choice) is False
        elif definition.role == "parent":
            assert in_parent((record,), choice) is True
        elif definition.role == "predicate":
            assert predicate_holds((record,), choice) is False
        else:
            assert definition.role in APPLIED_WITHOUT_RULE, definition.role
