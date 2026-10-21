"""#52: year-first slash times with seconds and fractional seconds, as some ticketing exports write them.

Synthetic boundaries only; the values are written here, never derived from the parser.
"""
from datetime import datetime

import pytest

from wise_platform_analytics.csv_inspection import inspect_csv
from wise_platform_analytics.time_formats import FORMATS, parse_format
from test_csv_preparation_core import choices, ready

NAME = "ymd_slash_second"


@pytest.mark.parametrize(("text", "expected"), [
    ("2010/01/13 08:40:25.000", datetime(2010, 1, 13, 8, 40, 25)),
    ("2010/01/13 08:40:25", datetime(2010, 1, 13, 8, 40, 25)),
    ("2010/01/13 08:40:25.5", datetime(2010, 1, 13, 8, 40, 25, 500000)),
    ("2010/01/13 08:40:25.123456", datetime(2010, 1, 13, 8, 40, 25, 123456)),
    ("2010/1/3 8:04:05", datetime(2010, 1, 3, 8, 4, 5)),
    ("2012/02/29 23:59:59.999999", datetime(2012, 2, 29, 23, 59, 59, 999999)),
    ("2010/12/31\t00:00:00", datetime(2010, 12, 31, 0, 0, 0)),
])
def test_year_first_slash_seconds_keep_their_precision(text, expected):
    assert NAME in FORMATS
    assert parse_format(text, NAME) == expected


@pytest.mark.parametrize("text", [
    "2010/01/13 08:40",               # no seconds: another format, not guessed
    "2010/01/13",                     # a date alone is never midnight
    "2010/01/13 08:40:25.1234567",    # beyond microseconds: unavailable, not truncated
    "2010/02/30 08:40:25",            # no such day
    "2011/02/29 08:40:25",            # not a leap year
    "2010/13/01 08:40:25",            # year, then month: a thirteenth month does not exist
    "2010/01/13 24:00:00",
    "2010/01/13 08:60:00",
    "13/01/2010 08:40:25",            # day first is another format
    "2010-01-13 08:40:25",            # ISO dashes are another format
    "2010/01/13 08:40:25Z",           # a written zone does not belong to this format
    "2010/01/13 08:40:25+01:00",
])
def test_other_shapes_and_impossible_values_are_not_read(text):
    assert parse_format(text, NAME) is None


def test_inspection_offers_the_format_only_where_it_reads_every_value():
    raw = (b"Case,Activity,At\r\n"
           b"H-1,Insert ticket,2010/01/13 08:40:25.000\r\n"
           b"H-1,Assign seriousness,2010/01/13 08:40:25.000\r\n"
           b"H-1,Resolve ticket,2010/04/20 10:31:12.000\r\n")
    inspected = inspect_csv(raw)
    counts = {match["format"]: match["parsed_count"] for match in inspected["role_suggestions"][2]["timestamp_matches"]}
    assert counts[NAME] == 3
    assert all(count == 0 for name, count in counts.items() if name != NAME)


def test_naive_values_need_an_explicit_clock_and_keep_raw_text_order_and_ties():
    raw = (b"Case;Activity;At\r\n"
           b"H-1;Insert ticket;2010/01/13 08:40:25.000\r\n"
           b"H-1;Assign seriousness;2010/01/13 08:40:25.000\r\n"
           b"H-1;Resolve ticket;2010/04/20 10:31:12.5\r\n"
           b"H-2;Insert ticket;2010/02/30 09:00:00\r\n"
           b"H-2;Closed;2010/03/01 09:00:00\r\n")
    wall = ready(raw, policies=choices(format_name=NAME))
    first, second, third = wall.histories["H-1"]
    # Recorded wall times: no zone is assigned, the fraction is kept, and equal times keep the file order.
    assert (first.local_timestamp, first.utc_instant) == ("2010-01-13T08:40:25", None)
    assert (first.source_position, second.source_position) == (0, 1)
    assert third.local_timestamp == "2010-04-20T10:31:12.500000"
    assert first.original_cells[2] == "2010/01/13 08:40:25.000"
    assert wall.sequence_evaluable("H-1")
    # An impossible date stays as written, unavailable, and its incident's order is not fully known.
    bad = next(row for row in wall.histories["H-2"] if row.source_position == 3)
    assert (bad.timestamp_status, bad.local_timestamp, bad.original_cells[2]) == ("invalid", None, "2010/02/30 09:00:00")
    assert not wall.sequence_evaluable("H-2")
    # With an explicit offset the same values become instants.
    fixed = ready(raw, policies=choices("offset", NAME))
    assert fixed.histories["H-1"][0].utc_instant is not None
