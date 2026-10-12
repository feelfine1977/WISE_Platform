"""Qualify the synthetic inputs and independent expected math, not product analytics."""
from fractions import Fraction
from pathlib import Path
import hashlib
import json
import pytest
import re
from fixture_reference import (raw_rows, case_rows, parent_cases, partition,
                               graph_and_variants, opening_category, opening_profile,
                               resolution_partition)

FIXTURES = Path(__file__).parent / 'fixtures' / 'incidents'
EXPECTED = json.loads((FIXTURES / 'expected.json').read_text(encoding='utf-8'))

@pytest.mark.parametrize('name', ['S0', 'S1', 'S2', 'S3'])
def test_inputs_match_the_frozen_synthetic_bytes(name):
    path = FIXTURES / (name + '.csv')
    assert hashlib.sha256(path.read_bytes()).hexdigest() == EXPECTED['file_sha256'][path.name]
    rows = raw_rows(path)
    assert len({r['source_event_id'] for r in rows}) == len(rows)
    assert all(r['incident_id'] and r['source_sequence'] for r in rows)

@pytest.mark.parametrize('name', ['S0', 'S1'])
def test_parent_and_presence_partition_preserve_all_case_rows(name):
    expected = EXPECTED['fixtures'][name]
    rows = raw_rows(FIXTURES / (name + '.csv'))
    cases = case_rows(rows)
    parent = parent_cases(cases)
    a, b = partition(parent)
    assert len(cases) == expected['base_cases']
    assert len(rows) == expected['base_records']
    assert len(parent) == expected['parent_cases']
    assert sum(len(h) for h in parent.values()) == expected['parent_records']
    assert a == expected['A_ids'] and b == expected['B_ids']
    assert not set(a) & set(b)
    assert set(a) | set(b) == set(parent)
    assert sum(len(parent[c]) for c in a) == expected['A_records']
    assert sum(len(parent[c]) for c in b) == expected['B_records']


def test_context_profile_keeps_missing_and_separates_the_two_lift_denominators():
    parent = parent_cases(case_rows(raw_rows(FIXTURES / 'S0.csv')))
    a, b = partition(parent)
    profile = opening_profile(parent, a, b)
    assert profile == EXPECTED['fixtures']['S0']['opening_profile']
    assert opening_category(parent['INC07']) == 'missing:assignment_group'
    assert parent['INC07'][1]['assignment_group'] == 'Desktop'
    app = profile['value:App']
    assert Fraction(app['composition_B_A']) == Fraction(7, 5)
    assert Fraction(app['outcome_lift']) == Fraction(6, 5)
    assert app['composition_B_A'] != app['outcome_lift']
    assert profile['value:Email']['composition_B_A'] == 'no_reference_support'
    # Literal inversion exchanges membership labels; the semantic target stays the same.
    inverse_a, inverse_b = b, a
    assert inverse_a == EXPECTED['fixtures']['S0']['B_ids']
    assert inverse_b == EXPECTED['fixtures']['S0']['A_ids']
    target_share = Fraction(sum(opening_category(parent[c]) == 'value:App' for c in inverse_a), len(inverse_a))
    reference_share = Fraction(sum(opening_category(parent[c]) == 'value:App' for c in inverse_b), len(inverse_b))
    assert target_share / reference_share == Fraction(7, 5)
    assert reference_share / target_share == Fraction(5, 7)


def test_map_matrix_variants_and_pair_evidence_share_case_membership():
    parent = parent_cases(case_rows(raw_rows(FIXTURES / 'S0.csv')))
    graph = graph_and_variants(parent)
    expected = EXPECTED['fixtures']['S0']
    for key in ('variants', 'edges', 'start', 'end'):
        assert graph[key] == expected[key]
    selected = graph['edges']['Opened > Assigned']['case_ids']
    assert selected == expected['selected_pair_ids']
    assert sum(len(parent[c]) for c in selected) == expected['selected_pair_records']
    assert Fraction(len(selected), len(parent)) == Fraction(1, 2)
    assert Fraction(graph['edges']['Opened > Assigned']['passages'], 9) == Fraction(2, 3)


def test_repeated_path_passages_differ_from_case_support_and_mean_from_median():
    parent = parent_cases(case_rows(raw_rows(FIXTURES / 'S1.csv')))
    graph = graph_and_variants(parent)
    expected = EXPECTED['fixtures']['S1']
    assert graph['variants'] == expected['variants']
    edge = graph['edges']['Assigned > Resolved']
    assert edge == expected['assigned_resolved']
    assert edge['cases'] == 4 and edge['passages'] == 5
    assert Fraction(edge['mean_hours']) == Fraction(9, 5)
    assert Fraction(edge['median_hours']) == 2
    assert len(parent['INC05']) == 6


def test_nullable_interval_is_a_third_partition_not_a_success():
    parent = parent_cases(case_rows(raw_rows(FIXTURES / 'S0.csv')))
    result = resolution_partition(parent, 4)
    expected = EXPECTED['fixtures']['Q1']
    for key in ('true_ids', 'false_ids', 'unknown_ids'):
        assert result[key] == expected[key]
    sets = [set(result[k]) for k in ('true_ids', 'false_ids', 'unknown_ids')]
    assert set.union(*sets) == set(parent)
    assert all(not left & right for i, left in enumerate(sets) for right in sets[i + 1:])
    assert len(sets[1]) == 7 and len(sets[2]) == 5


def test_missing_labels_do_not_create_ends_or_disappear_from_raw_evidence():
    rows = raw_rows(FIXTURES / 'S2.csv')
    parent = parent_cases(case_rows(rows))
    graph = graph_and_variants(parent)
    expected = EXPECTED['fixtures']['S2']
    assert len(rows) == expected['raw_records'] == 8
    assert sum(not r['activity'] for r in rows) == expected['omitted_activity_records'] == 2
    for key in ('variants', 'edges', 'start', 'end'):
        assert graph[key] == expected[key]
    assert 'Opened' not in graph['end']
    assert [r['source_sequence'] for r in parent['S2B']] == ['1', '2', '3', '4']
    assert rows[-2]['source_sequence'] == '4' and rows[-1]['source_sequence'] == '3'


def test_literal_unknown_category_is_not_a_missing_value():
    cases = case_rows(raw_rows(FIXTURES / 'S3.csv'))
    profile = {opening_category(history): [case] for case, history in cases.items()}
    assert profile == EXPECTED['fixtures']['S3']['opening_profile']
    assert len(profile) == 2


def test_named_policy_registry_is_machine_readable_and_versioned():
    registry = json.loads((FIXTURES / 'policy_ids.json').read_text(encoding='utf-8'))
    assert registry.pop('schema_version') == 1
    assert set(registry) == {'order', 'activity_projection', 'context_projection',
                             'parent', 'predicate', 'comparison', 'nullable_measure'}
    assert len(set(registry.values())) == len(registry)
    assert all(re.fullmatch(r'incident\.[a-z0-9_.]+\.v1', value) for value in registry.values())
    assert registry['comparison'] == 'incident.comparison.target_removed_reference_kept.v1'
    assert registry['nullable_measure'] == 'incident.measure.unevaluable_separate_from_true_false.v1'
