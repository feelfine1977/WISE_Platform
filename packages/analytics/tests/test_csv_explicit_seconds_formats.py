"""Explicit precision and locale-independent clocks over actual generic CSV rows."""
from datetime import datetime

import pytest

from wise_platform_analytics.csv_inspection import inspect_csv
from wise_platform_analytics.preparation import PreparationResult, prepare
from wise_platform_analytics.time_formats import FORMATS, parse_format
from test_csv_preparation_core import choices, dialect, roles, ready


@pytest.mark.parametrize(('name','text','expected'),[
    ('dmy_dot_second','13.10.2026 8:05:06',datetime(2026,10,13,8,5,6)),
    ('mdy_dot_second','10.13.2026 8:05:06.1',datetime(2026,10,13,8,5,6,100000)),
    ('dmy_slash_second','13/10/2026\t8:05:06.123456',datetime(2026,10,13,8,5,6,123456)),
    ('mdy_slash_second','10/13/2026 8:05:06.000001',datetime(2026,10,13,8,5,6,1)),
    ('dmy_dot_second','13.10.2026\t8:05:06',datetime(2026,10,13,8,5,6)),
    ('mdy_slash_12h_minute','10/13/2026 12:00 AM',datetime(2026,10,13,0)),
    ('mdy_slash_12h_minute','10/13/2026 12:00 PM',datetime(2026,10,13,12)),
    ('mdy_slash_12h_minute','10/13/2026 1:05 pm',datetime(2026,10,13,13,5)),
    ('mdy_slash_12h_second','10/13/2026 12:00:00.000001 aM',datetime(2026,10,13,0,0,0,1)),
    ('mdy_slash_12h_second','10/13/2026 12:00:00 PM',datetime(2026,10,13,12)),
    ('mdy_slash_12h_second','10/13/2026 11:59:59.123456 PM',datetime(2026,10,13,23,59,59,123456)),
])
def test_explicit_new_precision_and_ampm_clock(name,text,expected):
    assert name in FORMATS
    assert parse_format(text,name)==expected


@pytest.mark.parametrize(('name','text'),[
    ('dmy_dot_second','13.10.2026 08:05'),
    ('dmy_dot_minute','13.10.2026 08:05:06'),
    ('mdy_dot_minute','10.13.2026 08:05:06.123'),
    ('dmy_slash_minute','13/10/2026 08:05:06'),
    ('mdy_slash_minute','10/13/2026 08:05:06'),
    ('dmy_dot_second','13.10.2026 08:05:06.1234567'),
    ('mdy_dot_second','10.13.2026 08:05:06.1234567'),
    ('dmy_slash_second','13/10/2026 08:05:06.1234567'),
    ('mdy_slash_second','10/13/2026 08:05:06.1234567'),
    ('mdy_slash_12h_second','10/13/2026 12:00:00.1234567 AM'),
    ('mdy_slash_12h_minute','10/13/2026 00:00 AM'),
    ('mdy_slash_12h_minute','10/13/2026 13:00 PM'),
    ('mdy_slash_12h_minute','10/13/2026 12:60 AM'),
    ('mdy_slash_12h_minute','10/13/2026 12:00 vorm.'),
    ('mdy_slash_12h_second','10/13/2026 12:00:60 AM'),
    ('mdy_slash_12h_second','02/30/2026 12:00:00 AM'),
    ('dmy_dot_second','31.02.2026 08:00:00'),
    ('dmy_dot_second','13.10.2026 24:00:00'),
    ('dmy_dot_second','13.10.2026 08:00:00+00:99'),
])
def test_unsupported_precision_calendar_clock_and_ampm_are_not_normalized(name,text):
    assert parse_format(text,name) is None


def test_cp1252_semicolon_seconds_are_inspected_then_prepared_with_exact_raw_precision():
    raw=(' Ticket ; Event ; At ; Desk \r\n'
         'DE-01;Prüfung;13.10.2026 08:00:01.7;Übernahme\r\n'
         'DE-01;Rückfrage;13.10.2026 08:00:02.123456;Unknown\r\n').encode('cp1252')
    inspected=inspect_csv(raw)
    assert inspected['record_count']==2
    counts={m['format']:m['parsed_count'] for m in inspected['role_suggestions'][2]['timestamp_matches']}
    assert counts['dmy_dot_second']==2 and counts['dmy_dot_minute']==0
    prepared=ready(raw,encoding='windows-1252',mapping=roles(context=(3,)),policies=choices(format_name='dmy_dot_second'))
    assert prepared.source==raw and prepared.sequence_evaluable('DE-01')
    first,second=prepared.histories['DE-01']
    assert first.local_timestamp=='2026-10-13T08:00:01.700000' and first.utc_instant is None
    assert second.local_timestamp=='2026-10-13T08:00:02.123456'
    assert first.original_cells==('DE-01','Prüfung','13.10.2026 08:00:01.7','Übernahme')
    assert second.context[0].value=='Unknown'
    utc=ready(raw,encoding='windows-1252',policies=choices('offset','dmy_dot_second'))
    assert utc.histories['DE-01'][0].utc_instant=='2026-10-13T06:00:01.700000Z'


def test_ampm_actual_csv_midnight_noon_and_fractional_second_are_explicit_and_ordered():
    raw=b'Case;Activity;At\nA;Noon;10/13/2026 12:00:00 PM\nA;Midnight;10/13/2026 12:00:00.000001 AM\nA;Afternoon;10/13/2026 1:00:00 PM\n'
    prepared=ready(raw,policies=choices(format_name='mdy_slash_12h_second'))
    assert [(r.activity,r.local_timestamp,r.source_position) for r in prepared.histories['A']]==[
        ('Midnight','2026-10-13T00:00:00.000001',1),('Noon','2026-10-13T12:00:00',0),('Afternoon','2026-10-13T13:00:00',2)]
    assert prepared.sequence_evaluable('A')


@pytest.mark.parametrize(('name','text'),[
    ('dmy_dot_second','13.10.2026 08:00:00.1234567'),
    ('mdy_slash_12h_second','10/13/2026 12:00:00.1234567 AM'),
    ('dmy_dot_second','31.02.2026 08:00:00'),
    ('dmy_dot_second','13.10.2026 08:60:00'),
    ('iso8601','2026-10-13T08:00:00+00:99'),
])
def test_invalid_new_values_survive_confirmation_as_raw_unevaluable_evidence(name,text):
    raw=f'Case;Activity;At\nA;Observed;{text}\n'.encode()
    before=prepare(raw,dialect(),roles(),choices(format_name=name),False)
    assert isinstance(before,PreparationResult) and before.state=='needs_confirmation' and before.preparation is None
    prepared=ready(raw,policies=choices(format_name=name))
    row=prepared.histories['A'][0]
    assert row.timestamp_status=='invalid' and row.time_value is None
    assert row.utc_instant is None and row.local_timestamp is None
    assert row.original_cells[2]==text and not prepared.sequence_evaluable('A')


def test_inspection_frequency_weighted_counts_distinct_values_and_missing_are_exact():
    raw=('ID;Activity;At;Sequence\n'
         'A;Observed;09.10.2026 08:00:01.25;1\n'
         'A;Observed;09.10.2026 08:00:01.25;1\n'
         'B;Observed;13.10.2026 08:00:02;2\n'
         'B;Unknown;;2\n').encode()
    result=inspect_csv(raw)
    timestamp=result['role_suggestions'][2]
    assert timestamp['nonempty_count']==3 and timestamp['distinct_nonempty_count']==2
    counts={m['format']:m['parsed_count'] for m in timestamp['timestamp_matches']}
    assert counts['dmy_dot_second']==3 and counts['mdy_dot_second']==2
    assert counts['dmy_dot_minute']==0 and counts['iso8601']==0
    assert result['role_suggestions'][1]['nonempty_count']==4
    assert result['role_suggestions'][1]['distinct_nonempty_count']==2
    assert 'source_sequence' in result['role_suggestions'][3]['roles']


@pytest.mark.parametrize(('name','text'),[
    ('dmy_dot_minute',' 9.10.2026 8:5'),('mdy_dot_minute','10. 9.2026\t8:5'),
    ('dmy_slash_minute','9/10/2026\n8:5'),('mdy_slash_minute','10/9/2026  8:5')])
def test_numeric_guard_preserves_preexisting_one_digit_day_and_whitespace(name,text):
    assert parse_format(text,name)==datetime(2026,10,9,8,5)


@pytest.mark.parametrize('text',['2026-10-13T08:00:00.123456+02:00','2026-10-13 08:00:00.123456+02:00'])
def test_iso_t_space_offsets_and_microseconds_remain_supported(text):
    value=parse_format(text,'iso8601')
    assert value is not None and value.microsecond==123456 and value.utcoffset().total_seconds()==7200
