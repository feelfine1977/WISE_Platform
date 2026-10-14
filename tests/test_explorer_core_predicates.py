"""Complete-case predicates against independent literal CSV memberships."""
from pathlib import Path
import json

import pytest

from test_import_acceptance import policies
from wise_platform_analytics.preparation import PreparationResult, prepare
from wise_platform_analytics import selection as core

FIXTURES = Path(__file__).parent / 'fixtures' / 'explorer'
EXPECTED = json.loads((FIXTURES / 'core-v1.expected.json').read_text())


@pytest.fixture
def prepared():
    chosen = policies()
    chosen['time']['parameters']['snapshot_cutoff_utc'] = '2026-10-06T00:00:00Z'
    result = prepare((FIXTURES / 'core-v1.csv').read_bytes(),
                     {'encoding': 'utf-8', 'delimiter': ',', 'quotechar': '"', 'header': 'first_record'},
                     {'case_column': 0, 'activity_column': 1, 'timestamp_column': 2,
                      'sequence_column': 3, 'context_columns': [4]}, chosen, True)
    assert isinstance(result, PreparationResult) and result.preparation is not None
    return result.preparation


def predicate(name, *args, **kwargs):
    return getattr(core, name)(*args, **kwargs)


def partition(result):
    return {name: getattr(result, name).to_dict() for name in ('kept', 'removed', 'unevaluable')}


@pytest.mark.parametrize('name, arguments, negate, expected', [
    ('OpeningAttributeIn', (4, ('East',)), False, 'opening_East'),
    ('RecordAttributeIn', (4, ('East',)), False, 'any_record_East'),
    ('RecordAttributeIn', (4, (None, 'Unknown')), False, 'any_record_missing_Unknown'),
    ('RecordAttributeIn', (4, ('East',)), True, 'negated_any_record_East'),
    ('ObservedSpanAtLeast', (0,), False, 'observed_span_at_least_0'),
    ('ObservedSpanAtLeast', (0,), True, 'negated_observed_span_at_least_0'),
    ('ObservedSpanAtLeast', (2,), False, 'observed_span_at_least_2'),
    ('MaxRawGapAtLeast', (0,), False, 'max_raw_gap_at_least_0'),
    ('MaxRawGapAtLeast', (1,), False, 'max_raw_gap_at_least_1'),
    ('MaxRawGapAtLeast', (1,), True, 'negated_max_raw_gap_at_least_1'),
], ids=['first-context', 'any-context', 'missing-and-literal', 'negated-any', 'span-zero',
         'negated-span-zero', 'span-boundary', 'gap-zero', 'gap-boundary', 'negated-gap'])
def test_literal_memberships_preserve_complete_records(prepared, name, arguments, negate, expected):
    before = {case: tuple(row.to_dict() for row in history) for case, history in prepared.histories.items()}
    selected = core.select_cases(prepared, [predicate(name, *arguments, negate=negate)])
    assert partition(selected) == EXPECTED[expected]
    assert before == {case: tuple(row.to_dict() for row in history) for case, history in prepared.histories.items()}


def test_first_raw_date_window_is_half_open_and_preserves_later_records(prepared):
    window = predicate('CaseStartInWindow', 'utc_instant', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z')
    selected = core.select_cases(prepared, [window])
    assert partition(selected) == EXPECTED['date_Oct1_Oct2']
    assert [row.source_position for row in prepared.histories['A']] == [0, 1, 2]
    assert prepared.histories['A'][-1].activity == 'Reminder'
    assert 'B' in selected.removed.case_ids
    assert selected.unevaluable.case_ids == ('E',)


def test_false_dominates_unknown_and_order_independent_presence_stays_known(prepared):
    selected = core.select_cases(prepared, [predicate('RecordAttributeIn', 4, ('East',)),
                                            predicate('MaxRawGapAtLeast', 1)])
    assert partition(selected) == EXPECTED['any_record_East_AND_gap_at_least_1']
    selected = core.select_cases(prepared, [predicate('MaxRawGapAtLeast', 1),
                                            predicate('CaseIdIn', ('A',))])
    assert selected.kept.case_ids == ('A',)
    assert selected.unevaluable.case_ids == ()
    assert selected.removed.case_ids == ('B', 'C', 'D', 'E', 'F', 'G', 'H')


def test_id_filter_keeps_frozen_parent_and_all_raw_case_records(prepared):
    selected = core.select_cases(prepared, [predicate('CaseIdIn', ('A', 'E'))])
    assert selected.parent.case_ids == tuple('ABCDEFGH')
    assert selected.kept.case_ids == ('A', 'E') and selected.kept.record_count == 5
    assert selected.unevaluable.case_count == 0
    assert core.select_cases(prepared, [predicate('CaseIdIn', ('A',), negate=True)]).kept.case_ids == tuple('BCDEFGH')


def test_set_and_numeric_meaning_has_stable_identity_but_descriptors_echo_order(prepared):
    first = predicate('CaseIdIn', ('B', 'A'))
    second = predicate('CaseIdIn', ('A', 'B'))
    assert core.select_cases(prepared, [first]).identity_dict() == core.select_cases(prepared, [second]).identity_dict()
    assert core.predicate_descriptor(first)['case_ids'] == ['B', 'A']
    assert core.select_cases(prepared, [predicate('OpeningAttributeIn', 4, ('West', None, 'East'))]).population_id == (
        core.select_cases(prepared, [predicate('OpeningAttributeIn', 4, ('East', 'West', None))]).population_id)
    assert core.select_cases(prepared, [predicate('ObservedSpanAtLeast', 2)]).population_id == (
        core.select_cases(prepared, [predicate('ObservedSpanAtLeast', 2.0)]).population_id)


@pytest.mark.parametrize('name, args, extra', [
    ('CaseIdIn', ((),), {}), ('CaseIdIn', (('A', 'A'),), {}),
    ('OpeningAttributeIn', (4, ()), {}), ('OpeningAttributeIn', (4, ('East', 'East')), {}),
    ('RecordAttributeIn', (4, ('',)), {}), ('RecordAttributeIn', (True, ('East',)), {}),
    ('ObservedSpanAtLeast', (True,), {}), ('ObservedSpanAtLeast', (-1,), {}),
    ('MaxRawGapAtLeast', (float('nan'),), {}), ('MaxRawGapAtLeast', (float('inf'),), {}),
    ('CaseIdIn', (('A',),), {'negate': 1}),
    ('CaseStartInWindow', ('utc_instant', '2026-10-02T00:00:00Z', '2026-10-01T00:00:00Z'), {}),
    ('CaseStartInWindow', ('utc_instant', '2026-02-30T00:00:00Z', '2026-10-01T00:00:00Z'), {}),
    ('CaseStartInWindow', ('wall_clock', '2026-10-01T00:00:00', '2026-10-02T00:00:00'), {}),
], ids=['no-ids', 'duplicate-ids', 'no-values', 'duplicate-values', 'empty-value', 'bool-column',
         'bool-hours', 'negative-hours', 'nan', 'infinity', 'bool-negation', 'reversed-window',
         'invalid-calendar', 'wrong-clock'])
def test_invalid_predicate_never_silently_changes_population(prepared, name, args, extra):
    with pytest.raises(core.SelectionError) as refused:
        core.select_cases(prepared, [predicate(name, *args, **extra)])
    assert refused.value.code == 'invalid_predicate'


def test_unknown_or_outside_parent_id_refuses_entire_set(prepared):
    for ids, parent, code in [(('A', 'absent'), None, 'unknown_case'),
                              (('A', 'B'), ['A'], 'case_outside_parent')]:
        with pytest.raises(core.SelectionError) as refused:
            core.select_cases(prepared, [predicate('CaseIdIn', ids)], parent)
        assert refused.value.code == code
