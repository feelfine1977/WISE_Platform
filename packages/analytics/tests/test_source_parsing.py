"""Reading an event-history source into records, or refusing it with the row and the reason."""

import pytest

from wise_platform_analytics.parsing import ParsedSource, parse_source
from wise_platform_analytics.refusals import Refusal, RefusalCode


def parsed(source: bytes) -> ParsedSource:
    result = parse_source(source)
    assert isinstance(result, ParsedSource), result
    return result


def refused(source: bytes) -> Refusal:
    result = parse_source(source)
    assert isinstance(result, Refusal), result
    assert result.code is RefusalCode.MALFORMED_SOURCE
    assert result.message
    return result


def test_each_row_is_one_record_with_its_position_in_the_source(csv_source):
    result = parsed(
        csv_source(
            "A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            "B,b-1,1,Opened,2026-10-01T09:30:00Z,S,Network",
            "A,a-2,2,Resolved,2026-10-01T12:00:00Z,S,Desk",
        )
    )

    assert result.columns == (
        "incident_id",
        "source_event_id",
        "source_sequence",
        "activity",
        "timestamp_utc",
        "service",
        "assignment_group",
    )
    assert [record.position for record in result.records] == [1, 2, 3]
    assert [record.line for record in result.records] == [2, 3, 4]
    assert [record.incident_id for record in result.records] == ["A", "B", "A"]
    assert [record.source_event_id for record in result.records] == [
        "a-1",
        "b-1",
        "a-2",
    ]
    assert [record.sequence for record in result.records] == [1, 1, 2]
    assert result.records[2].cells == (
        "A",
        "a-2",
        "2",
        "Resolved",
        "2026-10-01T12:00:00Z",
        "S",
        "Desk",
    )


def test_an_empty_cell_is_missing_and_the_text_unknown_is_a_value(csv_source):
    result = parsed(
        csv_source(
            "A,,1,,2026-10-01T09:00:00Z,,",
            "B,b-1,1,Unknown,2026-10-01T09:00:00Z,Unknown,Unknown",
        )
    )

    missing, literal = result.records
    assert missing.cells == ("A", None, "1", None, "2026-10-01T09:00:00Z", None, None)
    assert missing.source_event_id is None
    assert missing.activity is None
    assert literal.cells == (
        "B",
        "b-1",
        "1",
        "Unknown",
        "2026-10-01T09:00:00Z",
        "Unknown",
        "Unknown",
    )
    assert literal.activity == "Unknown"


def test_cell_text_is_kept_exactly_as_written(csv_source):
    result = parsed(csv_source('A, a-1 ,1," Opened, twice ",2026-10-01T09:00:00Z,S, '))

    assert result.records[0].cells == (
        "A",
        " a-1 ",
        "1",
        " Opened, twice ",
        "2026-10-01T09:00:00Z",
        "S",
        " ",
    )


def test_a_byte_order_mark_and_windows_line_ends_do_not_change_the_records(csv_source):
    rows = (
        "A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk",
        "A,a-2,2,,2026-10-01T10:00:00Z,S,",
    )

    plain = parsed(csv_source(*rows))
    windows = parsed(csv_source(*rows, newline="\r\n", bom=True))

    assert windows == plain
    assert windows.columns[0] == "incident_id"
    assert windows.records[1].cells[-1] is None


def test_a_final_row_without_a_line_end_is_read(csv_source):
    source = csv_source("A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk").rstrip(b"\n")

    assert len(parsed(source).records) == 1


def test_a_quoted_cell_may_span_lines_and_later_rows_report_their_real_line(csv_source):
    result = parsed(
        csv_source(
            'A,a-1,1,"Opened\nby phone",2026-10-01T09:00:00Z,S,Desk',
            "A,a-2,2,Resolved,2026-10-01T12:00:00Z,S,Desk",
        )
    )

    assert result.records[0].activity == "Opened\nby phone"
    assert [(record.position, record.line) for record in result.records] == [
        (1, 2),
        (2, 4),
    ]


def test_blank_lines_carry_no_record_and_are_not_counted(csv_source):
    result = parsed(
        csv_source(
            "A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            "",
            "A,a-2,2,Resolved,2026-10-01T12:00:00Z,S,Desk",
            "",
        )
    )

    assert [(record.position, record.line) for record in result.records] == [
        (1, 2),
        (2, 4),
    ]


def test_identical_rows_are_separate_records(csv_source):
    row = "A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk"

    result = parsed(csv_source(row, row))

    assert [record.position for record in result.records] == [1, 2]
    assert result.records[0].cells == result.records[1].cells


def test_columns_are_found_by_name_and_further_columns_are_kept(csv_source):
    result = parsed(
        csv_source(
            "High,Desk,S,2026-10-01T09:00:00Z,Opened,1,a-1,A",
            ",,,2026-10-01T10:00:00Z,,2,,A",
            header="priority,assignment_group,service,timestamp_utc,activity,source_sequence,source_event_id,incident_id",
        )
    )

    assert result.columns[0] == "priority"
    first, second = result.records
    assert (
        first.incident_id,
        first.source_event_id,
        first.activity,
        first.sequence,
    ) == ("A", "a-1", "Opened", 1)
    assert first.cells[0] == "High"
    assert second.cells == (
        None,
        None,
        None,
        "2026-10-01T10:00:00Z",
        None,
        "2",
        None,
        "A",
    )


def test_timestamps_become_exact_instants(csv_source):
    result = parsed(
        csv_source(
            "A,,1,x,1970-01-01T00:00:01Z,,",
            "A,,2,x,1970-01-01T00:00:01.5Z,,",
            "A,,3,x,1970-01-01T00:00:01.000000001Z,,",
            "A,,4,x,1969-12-31T23:59:59.25Z,,",
            "A,,5,x,2026-10-01T09:00:00Z,,",
            "A,,6,x,2026-10-01T09:00:00.000Z,,",
        )
    )

    instants = [record.instant_ns for record in result.records]
    assert instants[:4] == [1_000_000_000, 1_500_000_000, 1_000_000_001, -750_000_000]
    assert instants[4] == instants[5] == 1_790_845_200 * 1_000_000_000


def test_the_sequence_is_a_whole_number(csv_source):
    result = parsed(
        csv_source(
            "A,,007,x,2026-10-01T09:00:00Z,,",
            "A,,-2,x,2026-10-01T09:00:00Z,,",
            "A,,123456789012345678,x,2026-10-01T09:00:00Z,,",
        )
    )

    assert [record.sequence for record in result.records] == [7, -2, 123456789012345678]
    assert result.records[0].cells[2] == "007"


def test_bytes_that_are_not_utf8_are_refused_with_the_line():
    source = (
        b"incident_id,source_event_id,source_sequence,activity,timestamp_utc,service,assignment_group\n"
        b"A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk\n"
        b"B,b-1,1,Er\xf6ffnet,2026-10-01T09:00:00Z,S,Desk\n"
    )

    refusal = refused(source)

    assert refusal.detail["reason"] == "not_utf8"
    assert refusal.detail["line"] == 3
    assert refusal.detail["source_position"] is None
    assert refusal.detail["byte_offset"] == source.index(b"\xf6")


@pytest.mark.parametrize("source", [b"", b"\xef\xbb\xbf", b"\n\r\n"])
def test_a_source_without_a_header_is_refused(source):
    refusal = refused(source)

    assert refusal.detail == {
        "reason": "missing_header",
        "line": None,
        "source_position": None,
    }


@pytest.mark.parametrize(
    "column",
    [
        "incident_id",
        "source_event_id",
        "source_sequence",
        "activity",
        "timestamp_utc",
        "service",
        "assignment_group",
    ],
)
def test_a_missing_required_column_is_refused_by_name(csv_source, column):
    columns = [
        name
        for name in (
            "incident_id",
            "source_event_id",
            "source_sequence",
            "activity",
            "timestamp_utc",
            "service",
            "assignment_group",
        )
        if name != column
    ]

    refusal = refused(
        csv_source("A,a-1,1,Opened,2026-10-01T09:00:00Z,S", header=",".join(columns))
    )

    assert refusal.detail == {
        "reason": "missing_column",
        "line": 1,
        "source_position": None,
        "column": column,
    }
    assert column in refusal.message


def test_column_names_are_matched_exactly(csv_source):
    refusal = refused(
        csv_source(
            "A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            header="Incident_ID,source_event_id,source_sequence,activity,timestamp_utc,service,assignment_group",
        )
    )

    assert refusal.detail["reason"] == "missing_column"
    assert refusal.detail["column"] == "incident_id"


def test_a_column_named_twice_is_refused(csv_source):
    refusal = refused(
        csv_source(
            "A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk,Desk",
            header="incident_id,source_event_id,source_sequence,activity,timestamp_utc,service,assignment_group,service",
        )
    )

    assert refusal.detail == {
        "reason": "duplicate_column",
        "line": 1,
        "source_position": None,
        "column": "service",
    }


def test_a_column_without_a_name_is_refused(csv_source):
    refusal = refused(
        csv_source(
            "A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk,",
            header="incident_id,source_event_id,source_sequence,activity,timestamp_utc,service,assignment_group,",
        )
    )

    assert refusal.detail == {
        "reason": "unnamed_column",
        "line": 1,
        "source_position": None,
    }


def test_a_header_without_data_rows_is_refused_and_is_not_an_empty_success(csv_source):
    refusal = refused(csv_source())

    assert refusal.detail == {
        "reason": "no_data_rows",
        "line": None,
        "source_position": None,
    }


@pytest.mark.parametrize(
    ("row", "actual"),
    [
        ("B,b-1,1,Opened,2026-10-01T09:00:00Z,S", 6),
        ("B,b-1,1,Opened,2026-10-01T09:00:00Z,S,Desk,extra", 8),
    ],
)
def test_a_row_with_the_wrong_number_of_cells_is_refused(csv_source, row, actual):
    refusal = refused(csv_source("A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk", row))

    assert refusal.detail == {
        "reason": "wrong_cell_count",
        "line": 3,
        "source_position": 2,
        "expected": 7,
        "actual": actual,
    }


def test_an_empty_incident_id_is_refused_with_the_row(csv_source):
    refusal = refused(
        csv_source(
            "A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            "",
            ",b-1,1,Opened,2026-10-01T09:00:00Z,S,Desk",
        )
    )

    assert refusal.detail == {
        "reason": "empty_incident_id",
        "line": 4,
        "source_position": 2,
        "column": "incident_id",
    }
    assert "row 2" in refusal.message


@pytest.mark.parametrize(
    "value",
    [
        "",
        "yesterday",
        "2026-10-01",
        "2026-10-01T09:00:00",
        "2026-10-01 09:00:00Z",
        "2026-10-01T09:00:00+00:00",
        "2026-10-01T09:00:00z",
        "2026-10-01t09:00:00Z",
        "2026-10-01T09:00Z",
        "2026-02-30T09:00:00Z",
        "2026-10-01T24:00:00Z",
        "2026-10-01T23:59:60Z",
        "0000-01-01T00:00:00Z",
        "2026-10-01T09:00:00.Z",
        "2026-10-01T09:00:00.0000000001Z",
        " 2026-10-01T09:00:00Z",
        "2026-10-01T09:00:00Z ",
        "٢٠٢٦-10-01T09:00:00Z",
    ],
)
def test_a_timestamp_that_cannot_be_read_is_refused_with_the_row_and_the_value(
    csv_source, value
):
    refusal = refused(
        csv_source(
            "A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            f"A,a-2,2,Resolved,{value},S,Desk",
        )
    )

    assert refusal.detail == {
        "reason": "unparsable_timestamp",
        "line": 3,
        "source_position": 2,
        "column": "timestamp_utc",
        "value": value or None,
    }


@pytest.mark.parametrize(
    "value",
    ["", "first", "1.0", "1e3", " 1", "1 ", "+1", "--1", "٣", "1234567890123456789"],
)
def test_a_sequence_that_cannot_be_read_is_refused_with_the_row_and_the_value(
    csv_source, value
):
    refusal = refused(csv_source(f"A,a-1,{value},Opened,2026-10-01T09:00:00Z,S,Desk"))

    assert refusal.detail == {
        "reason": "unparsable_sequence",
        "line": 2,
        "source_position": 1,
        "column": "source_sequence",
        "value": value or None,
    }


def test_broken_quoting_is_refused_with_the_row(csv_source):
    refusal = refused(
        csv_source(
            "A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            'A,a-2,2,"Resolved" late,2026-10-01T12:00:00Z,S,Desk',
        )
    )

    assert refusal.detail == {
        "reason": "invalid_csv",
        "line": 3,
        "source_position": 2,
    }


def test_a_quote_that_is_never_closed_is_reported_where_its_row_starts(csv_source):
    refusal = refused(
        csv_source(
            "A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            'A,a-2,2,"Resolved,2026-10-01T12:00:00Z,S,Desk',
            "A,a-3,3,Closed,2026-10-01T13:00:00Z,S,Desk",
            "A,a-4,4,Archived,2026-10-01T14:00:00Z,S,Desk",
        )
    )

    assert refusal.detail == {
        "reason": "invalid_csv",
        "line": 3,
        "source_position": 2,
    }
    assert "line 3" in refusal.message


def test_broken_quoting_in_the_header_is_refused_without_a_data_row(csv_source):
    refusal = refused(csv_source(header='incident_id,"source_event_id" x'))

    assert refusal.detail == {
        "reason": "invalid_csv",
        "line": 1,
        "source_position": None,
    }


def test_the_first_malformed_row_is_the_one_reported(csv_source):
    refusal = refused(
        csv_source(
            "A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk",
            "A,a-2,two,Resolved,2026-10-01T12:00:00Z,S,Desk",
            ",a-3,3,Closed,never,S,Desk",
        )
    )

    assert refusal.detail["reason"] == "unparsable_sequence"
    assert refusal.detail["source_position"] == 2


def test_a_long_offending_value_is_shortened_in_the_message_only(csv_source):
    value = "9" * 500

    refusal = refused(csv_source(f"A,a-1,{value},Opened,2026-10-01T09:00:00Z,S,Desk"))

    assert refusal.detail["value"] == value
    assert len(refusal.message) < 250
