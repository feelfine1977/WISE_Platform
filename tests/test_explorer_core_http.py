"""Public HTTP checks for new complete-case predicates and their saved/comparison mirrors."""
from copy import deepcopy
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker

from test_import_acceptance import client, workspace, envelope, policies, upload, prepare, population, evidence
from test_explorer_core_predicates import EXPECTED, FIXTURES
from wise_platform_api.app import create_app

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = {kind: json.loads((ROOT / f'contracts/{kind}.schema.json').read_text())
           for kind in ('selection', 'comparison', 'saving')}
VALIDATORS = {kind: Draft202012Validator(schema, format_checker=FormatChecker())
              for kind, schema in SCHEMAS.items()}


def intent(kind, negate=False, **fields):
    return {'kind': kind, **fields, 'negate': negate}


def window():
    return {'timestamp_kind': 'utc_instant', 'start_inclusive': '2026-10-01T00:00:00Z',
            'end_exclusive': '2026-10-02T00:00:00Z'}


@pytest.fixture
def reading(client, workspace):
    source = upload(client, workspace, (FIXTURES / 'core-v1.csv').read_bytes(), 'synthetic-core.csv')
    chosen = policies()
    chosen['time']['parameters']['snapshot_cutoff_utc'] = '2026-10-06T00:00:00Z'
    request = envelope('confirm_mapping_request', workspace_id=workspace['workspace_id'], source_id=source['source_id'],
                       dialect={'encoding': 'utf-8', 'delimiter': ',', 'quotechar': '"', 'header': 'first_record'},
                       mapping={'case_column': 0, 'activity_column': 1, 'timestamp_column': 2,
                                'sequence_column': 3, 'context_columns': [4]},
                       policies=chosen, accept_report_issues=True)
    return population(client, workspace, prepare(client, request))


def selection_request(workspace, reading, predicates, parent=None):
    return envelope('select_cases_request', 'core-select', 2, workspace_id=workspace['workspace_id'],
                    identity=reading['identity'], parent_case_ids=parent, predicates=predicates)


def select(client, workspace, reading, predicates, parent=None):
    request = selection_request(workspace, reading, predicates, parent)
    response = client.post('/api/investigations/select-cases', json=request)
    assert response.status_code == 200, response.text
    answer = response.json()
    VALIDATORS['selection'].validate(answer)
    assert [chip['predicate'] for chip in answer['predicate_results']] == predicates
    return answer


@pytest.mark.parametrize('predicate, expected', [
    (intent('opening_attribute_in', column_index=4, values=['East'],
            anchor_policy='incident.context.first_record_in_declared_order.v1'), 'opening_East'),
    (intent('record_attribute_in', column_index=4, values=['East']), 'any_record_East'),
    (intent('record_attribute_in', column_index=4, values=[None, 'Unknown']), 'any_record_missing_Unknown'),
    (intent('record_attribute_in', True, column_index=4, values=['East']), 'negated_any_record_East'),
    (intent('observed_span_at_least', hours=0), 'observed_span_at_least_0'),
    (intent('observed_span_at_least', True, hours=0), 'negated_observed_span_at_least_0'),
    (intent('observed_span_at_least', hours=2), 'observed_span_at_least_2'),
    (intent('max_raw_gap_at_least', hours=0), 'max_raw_gap_at_least_0'),
    (intent('max_raw_gap_at_least', hours=1), 'max_raw_gap_at_least_1'),
    (intent('max_raw_gap_at_least', True, hours=1), 'negated_max_raw_gap_at_least_1'),
    (intent('case_start_in_window', window=window()), 'date_Oct1_Oct2'),
], ids=['opening', 'ever', 'missing', 'negated-ever', 'span-zero', 'negated-span-zero',
         'span-boundary', 'gap-zero', 'gap-boundary', 'negated-gap', 'half-open'])
def test_http_literal_partitions_and_all_evidence(client, workspace, reading, predicate, expected):
    selected = select(client, workspace, reading, [predicate])
    assert {key: selected[key] for key in ('kept', 'removed', 'unevaluable')} == EXPECTED[expected]
    for case in selected['kept']['case_ids']:
        answer = evidence(client, workspace, selected, case)
        assert [row['source_position'] for row in answer['records']] == EXPECTED['original_row_positions_unchanged'][case]


def test_raw_echo_and_set_semantics_share_identity(client, workspace, reading):
    left = select(client, workspace, reading, [intent('case_id_in', case_ids=['B', 'A'])])
    right = select(client, workspace, reading, [intent('case_id_in', case_ids=['A', 'B'])])
    assert left['identity'] == right['identity']
    assert left['parent'] == reading['population']
    fractional = {**window(), 'start_inclusive': '2026-10-01T00:00:00.000000Z'}
    raw = select(client, workspace, reading, [intent('case_start_in_window', window=fractional)])
    canonical = select(client, workspace, reading, [intent('case_start_in_window', window=window())])
    assert raw['identity'] == canonical['identity']


@pytest.mark.parametrize('predicate, parent, code', [
    (intent('case_id_in', case_ids=['A', 'absent']), None, 'unknown_case'),
    (intent('case_id_in', case_ids=['A', 'B']), ['A'], 'case_outside_parent'),
    (intent('case_id_in', case_ids=['A', 'A']), None, 'invalid_predicate'),
    (intent('case_id_in', case_ids=[]), None, 'invalid_predicate'),
    (intent('record_attribute_in', column_index=4, values=[None, None]), None, 'invalid_predicate'),
    (intent('opening_attribute_in', column_index=4, values=['East', 'East'],
            anchor_policy='incident.context.first_record_in_declared_order.v1'), None, 'invalid_predicate'),
    (intent('record_attribute_in', column_index=4, values=['East'], anchor_policy='any'), None, 'invalid_predicate'),
    (intent('record_attribute_in', column_index=1, values=['East']), None, 'unmapped_context_column'),
    (intent('observed_span_at_least', hours=True), None, 'invalid_predicate'),
    (intent('max_raw_gap_at_least', hours=-1), None, 'invalid_predicate'),
    (intent('case_start_in_window', window={**window(), 'start_inclusive': '2026-10-01T00:00:00+00:00'}), None, 'invalid_predicate'),
    (intent('case_start_in_window', window={**window(), 'start_inclusive': '2026-10-02T00:00:00Z'}), None, 'invalid_predicate'),
], ids=['unknown', 'outside-parent', 'duplicate-ids', 'empty-ids', 'duplicate-null', 'duplicate-values',
         'wrong-anchor-kind', 'unmapped', 'bool-hours', 'negative-hours', 'offset-spelling', 'equal-window'])
def test_refusal_keeps_original_good_selection(client, workspace, reading, predicate, parent, code):
    good = select(client, workspace, reading, [intent('case_id_in', case_ids=['A'])])
    request = selection_request(workspace, reading, [predicate], parent)
    response = client.post('/api/investigations/select-cases', json=request)
    assert response.status_code == 422, response.text
    refusal = response.json()
    VALIDATORS['selection'].validate(refusal)
    assert refusal['code'] == code
    assert refusal['field']
    assert evidence(client, workspace, good, 'A')['coverage']['raw_record_count'] == 3


def group_request(workspace, reading, predicates):
    return envelope('compare_groups_request', 'core-group', 3, workspace_id=workspace['workspace_id'],
                    identity=reading['identity'], parent_case_ids=None, context_column_index=4,
                    context_policy='incident.context.first_record_in_declared_order.v1',
                    definition={'mode': 'two_named_groups',
                                'target': {'name': 'Criteria', 'definition': {'kind': 'predicates', 'predicates': predicates}},
                                'reference': {'name': 'All', 'definition': {'kind': 'predicates', 'predicates': []}}})


def save_request(workspace, reading, selected, predicates):
    return envelope('save_investigation_request', 'core-save', 4, workspace_id=workspace['workspace_id'],
                    investigation_id=None, expected_revision_id=None, name='Complete synthetic cases',
                    base_identity=reading['identity'], selection_identity=selected['identity'],
                    selection_recipe={'parent_case_ids': selected['parent']['case_ids'], 'predicates': predicates},
                    context_policy='incident.context.first_record_in_declared_order.v1',
                    comparison=None, notes='Recorded events only; no completion interpretation.', bookmarks=[])


def test_comparison_and_saved_recipe_decode_same_new_kinds(client, workspace, reading):
    predicates = [intent('case_id_in', case_ids=['H', 'A']), intent('observed_span_at_least', hours=2),
                  intent('max_raw_gap_at_least', hours=1), intent('record_attribute_in', column_index=4, values=['Unknown', 'East']),
                  intent('case_start_in_window', window={**window(), 'start_inclusive': '2026-10-01T00:00:00.000Z'})]
    selected = select(client, workspace, reading, predicates)
    comparison = group_request(workspace, reading, predicates)
    response = client.post('/api/investigations/compare-groups', json=comparison)
    assert response.status_code == 200, response.text
    answer = response.json()
    VALIDATORS['comparison'].validate(answer)
    assert answer['definition'] == comparison['definition']
    assert answer['target']['included'] == selected['kept']
    reordered = deepcopy(comparison)
    reordered['definition']['target']['definition']['predicates'][0]['case_ids'].reverse()
    assert client.post('/api/investigations/compare-groups', json=reordered).json()['comparison_id'] == answer['comparison_id']
    saving = save_request(workspace, reading, selected, predicates)
    response = client.post('/api/investigations/save', json=saving)
    assert response.status_code == 200, response.text
    saved = response.json()
    VALIDATORS['saving'].validate(saved)
    with TestClient(create_app(static_dir=Path(workspace['path']) / 'unbuilt')) as fresh:
        opened = fresh.post('/api/workspaces/open', json=envelope('open_workspace_request', path=workspace['path']))
        assert opened.status_code == 200
        restored = fresh.post('/api/investigations/reopen', json=envelope('reopen_investigation_request', 'core-reopen', 5,
                             workspace_id=workspace['workspace_id'], saved_revision_id=saved['revision']['saved_revision_id']))
        assert restored.status_code == 200, restored.text
        reopened = restored.json()
        VALIDATORS['saving'].validate(reopened)
        assert reopened['revision']['content']['selection_recipe']['predicates'] == predicates
        assert reopened['restored_selection']['identity'] == selected['identity']
        assert evidence(fresh, workspace, {'identity': reopened['restored_selection']['identity'], 'query_revision': reopened['query_revision']}, 'H')['coverage']['raw_record_count'] == 3


@pytest.mark.parametrize('kind', ['case_id_in', 'record_attribute_in', 'case_start_in_window'])
def test_nested_mirrors_refuse_source_only_constraints(client, workspace, reading, kind):
    valid = intent('case_id_in', case_ids=['A'])
    selected = select(client, workspace, reading, [valid])
    bad = {'case_id_in': intent(kind, case_ids=['A', 'A']),
           'record_attribute_in': intent(kind, column_index=4, values=['East', 'East']),
           'case_start_in_window': intent(kind, window={**window(), 'start_inclusive': '2026-10-01T00:00:00+00:00'})}[kind]
    response = client.post('/api/investigations/compare-groups', json=group_request(workspace, reading, [bad]))
    assert response.status_code == 422, response.text
    assert response.json()['code'] == 'invalid_predicate'
    saving = save_request(workspace, reading, selected, [bad])
    response = client.post('/api/investigations/save', json=saving)
    assert response.status_code == 400, response.text
    assert response.json()['code'] == 'invalid_request'




@pytest.mark.parametrize('location', ['target', 'reference', 'partition', 'saved-target', 'saved-reference', 'saved-partition'])
@pytest.mark.parametrize('bad', [intent('case_id_in', case_ids=['A', 'A']),
                              intent('record_attribute_in', column_index=4, values=[None, None]),
                              intent('case_start_in_window', window={**window(), 'start_inclusive': '2026-10-01T00:00:00+00:00'})],
                         ids=['duplicate-ids', 'duplicate-missing', 'utc-offset'])
def test_all_nested_comparison_and_save_paths_enforce_strict_wire(client, workspace, reading, location, bad):
    selected = select(client, workspace, reading, [])
    request = group_request(workspace, reading, [])
    definition = request['definition']
    if location.endswith('partition'):
        definition = {'mode': 'selection_partition', 'target_name': 'Kept', 'reference_name': 'Removed',
                      'predicates': [bad], 'target_side': 'kept'}
    else:
        role = 'reference' if location.endswith('reference') else 'target'
        definition[role]['definition']['predicates'] = [bad]
    if location.startswith('saved-'):
        saving = save_request(workspace, reading, selected, [])
        saving['comparison'] = {'kind': 'group', 'comparison_id': 'comparison.v1:sha256:' + 'a' * 64,
                                'parent_case_ids': selected['parent']['case_ids'], 'context_column_index': 4,
                                'context_policy': 'incident.context.first_record_in_declared_order.v1', 'definition': definition}
        response = client.post('/api/investigations/save', json=saving)
        assert response.status_code == 400, response.text
        assert response.json()['code'] == 'invalid_request'
        assert response.json()['field'].startswith('comparison.definition.')
    else:
        request['definition'] = definition
        response = client.post('/api/investigations/compare-groups', json=request)
        assert response.status_code == 422, response.text
        assert response.json()['code'] == 'invalid_predicate'
        assert response.json()['field'].startswith('definition.')
