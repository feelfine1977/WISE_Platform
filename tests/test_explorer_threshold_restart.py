"""Inclusive recorded-time thresholds and new filter recipes across real CLI processes."""
from pathlib import Path

import pytest

from test_import_acceptance import client, workspace, envelope, policies, upload, prepare, population, evidence
from test_explorer_core_http import FIXTURES, intent, select, save_request, window
from test_saved_investigation_restart import cli_host, loopback_port, open_workspace, save, reopen

ROOT = Path(__file__).resolve().parents[1]

def read_csv(client, workspace, raw, name, mapping):
    source = upload(client, workspace, raw, name)
    chosen = policies()
    chosen['time']['parameters']['snapshot_cutoff_utc'] = '2026-10-06T00:00:00Z'
    request = envelope('confirm_mapping_request', workspace_id=workspace['workspace_id'], source_id=source['source_id'],
                       dialect={'encoding': 'utf-8', 'delimiter': ',', 'quotechar': '"', 'header': 'first_record'},
                       mapping=mapping, policies=chosen, accept_report_issues=True)
    return population(client, workspace, prepare(client, request))

@pytest.mark.parametrize('kind,negate,kept,removed,unknown', [
    ('observed_span_at_least', False, ['BOUNDARY4', 'BOUNDARY5'], ['BOUNDARY3', 'BOUNDARYMISSING'], []),
    ('observed_span_at_least', True, ['BOUNDARY3', 'BOUNDARYMISSING'], ['BOUNDARY4', 'BOUNDARY5'], []),
    ('max_raw_gap_at_least', False, ['BOUNDARY4', 'BOUNDARY5'], ['BOUNDARY3'], ['BOUNDARYMISSING']),
    ('max_raw_gap_at_least', True, ['BOUNDARY3'], ['BOUNDARY4', 'BOUNDARY5'], ['BOUNDARYMISSING']),
])
def test_literal_three_four_five_hour_boundary_uses_inclusive_recorded_measure(client, workspace, kind, negate, kept, removed, unknown):
    reading = read_csv(client, workspace, (ROOT / 'tests/fixtures/incidents/exact-four-hour.csv').read_bytes(),
                       'synthetic-four-hour.csv', {'case_column': 0, 'activity_column': 3, 'timestamp_column': 4,
                       'sequence_column': 2, 'context_columns': [5, 6]})
    selected = select(client, workspace, reading, [intent(kind, negate, hours=4)])
    assert selected['kept']['case_ids'] == kept
    assert selected['removed']['case_ids'] == removed
    assert selected['unevaluable']['case_ids'] == unknown
    assert sum(selected[group]['record_count'] for group in ('kept', 'removed', 'unevaluable')) == 7
    repeated = select(client, workspace, reading, [intent(kind, negate, hours=4.0)])
    assert repeated['identity'] == selected['identity']

def test_all_six_filter_kinds_reopen_in_a_second_real_server_process(tmp_path):
    assert not tmp_path.resolve().is_relative_to(ROOT)
    path = tmp_path / 'recorded-investigation'
    path.mkdir()
    predicates = [intent('case_id_in', case_ids=['H', 'A']),
        intent('case_start_in_window', window=window()),
        intent('opening_attribute_in', column_index=4, values=['West', 'East'], anchor_policy='incident.context.first_record_in_declared_order.v1'),
        intent('record_attribute_in', column_index=4, values=['Unknown', 'East']),
        intent('observed_span_at_least', hours=2), intent('max_raw_gap_at_least', hours=1)]
    port = loopback_port()
    with cli_host(tmp_path, 'first-explorer', port) as (client, first):
        workspace = open_workspace(client, path, 'first-explorer-workspace')
        base = read_csv(client, workspace, (FIXTURES / 'core-v1.csv').read_bytes(), 'synthetic-eight-cases.csv',
                       {'case_column': 0, 'activity_column': 1, 'timestamp_column': 2, 'sequence_column': 3, 'context_columns': [4]})
        selected = select(client, workspace, base, predicates)
        assert selected['kept'] == {'case_ids': ['A', 'H'], 'case_count': 2, 'record_count': 6}
        assert selected['unevaluable']['case_count'] == 0
        before = {case: evidence(client, workspace, selected, case)['records'] for case in ('A', 'H')}
        saved = save(client, save_request(workspace, base, selected, predicates))
    assert first.poll() is not None
    with cli_host(tmp_path, 'second-explorer', port) as (client, second):
        assert second.pid != first.pid
        workspace = open_workspace(client, path, 'second-explorer-workspace')
        restored = reopen(client, workspace, saved['revision']['saved_revision_id'])
        assert restored['revision'] == saved['revision']
        assert restored['restored_selection']['identity'] == selected['identity']
        assert restored['revision']['content']['selection_recipe']['predicates'] == predicates
        after = {'identity': restored['restored_selection']['identity'], 'query_revision': restored['query_revision']}
        for case in ('A', 'H'):
            assert evidence(client, workspace, after, case)['records'] == before[case]
        listed = client.post('/api/investigations/case-list', json=envelope('case_list_request', 'restored-list', 22,
                            workspace_id=workspace['workspace_id'], identity=after['identity'],
                            query={'search_text': None, 'sort': {'field': 'observed_span_hours', 'direction': 'descending'}, 'offset': 0, 'limit': 200}))
        assert listed.status_code == 200, listed.text
        assert [row['case_id'] for row in listed.json()['rows']] == ['A', 'H']
        assert listed.json()['population_record_count'] == 6
    assert second.poll() is not None
