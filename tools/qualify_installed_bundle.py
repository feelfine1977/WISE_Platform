"""Exercise the installed artifact using isolated real CLI processes and HTTP."""
from contextlib import contextmanager
from copy import deepcopy
import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from zipfile import ZipFile

CONTEXT = 'incident.context.first_record_in_declared_order.v1'
B4_CUTOFF = '2026-10-09T12:00:00Z'
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def envelope(kind, **fields):
    return {'schema_version': 1, 'message_type': kind, 'request_id': kind + '-bundle', 'query_revision': 1, **fields}


def b_policies(cutoff='2027-01-01T00:00:00Z'):
    return {
        'time': {'id': 'incident.time.explicit_format_timezone_utc.v1', 'parameters': {'format': 'iso8601', 'timezone': {'mode': 'from_values'}, 'snapshot_cutoff_utc': cutoff}},
        'order': {'id': 'incident.order.declared_time_optional_sequence_source_position.v1', 'parameters': {'primary': 'usable_declared_time_ascending', 'secondary': 'mapped_sequence_or_source_position', 'tie_breaker': 'source_position_ascending', 'unavailable_timestamp': 'presentation_tail_source_position', 'unavailable_timestamp_case_sequence': 'unevaluable'}},
        'rows': {'id': 'incident.rows.missing_id_outside_invalid_time_retained.v1', 'parameters': {'missing_case_id': 'outside_population_preserve_source', 'unavailable_timestamp': 'retain_case_raw_flag_order_unknown', 'invalid_mapped_sequence': 'block_preparation', 'duplicate_candidates': 'retain_all'}},
        'missing_values': {'id': 'incident.missing.empty_mapped_activity_context.v1', 'parameters': {'empty_activity_context': 'missing', 'literal_values': 'preserve'}},
        'identifier': {'id': 'incident.identifier.trim_outer_whitespace.v1', 'parameters': {'normalization': 'trim_outer_whitespace_preserve_raw'}},
        'activity_projection': {'id': 'incident.activity.omit_missing_retain_raw_gaps.v1', 'parameters': {'missing_activity': 'omit_from_mapped_sequence', 'raw_records': 'retain_all', 'gap_evidence': 'omitted_row_ids'}},
        'parent': {'id': 'incident.parent.all_identified_cases.v1', 'parameters': {'eligibility': 'nonempty_normalized_case_identifier'}},
    }


def http(base, route, request=None, raw=None, query=None):
    url = base + route + ('?' + urllib.parse.urlencode(query) if query else '')
    body = raw if raw is not None else None if request is None else json.dumps(request, allow_nan=False).encode()
    req = urllib.request.Request(url, data=body, method='PUT' if raw is not None else 'POST' if request is not None else 'GET',
                                 headers={'Content-Type': 'application/octet-stream' if raw is not None else 'application/json'})
    try:
        with OPENER.open(req, timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def answer(base, route, request, kind):
    status, raw = http(base, route, request)
    assert 200 <= status < 300, (route, status, raw.decode(errors='replace'))
    result = json.loads(raw)
    assert result['message_type'] == kind, result
    for key in ('request_id', 'query_revision', 'workspace_id'):
        if key in request:
            assert result[key] == request[key], key
    return result


def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait(timeout=5)
    assert process.poll() is not None


@contextmanager
def host(work, attempt, port):
    env = {k: v for k, v in os.environ.items() if k not in {'PYTHONPATH', 'PYTHONHOME'}}
    log = work / ('host-' + str(attempt) + '.log')
    with log.open('wb') as stream:
        process = subprocess.Popen([sys.executable, '-I', '-m', 'wise_platform_api', '--host', '127.0.0.1', '--port', str(port)],
                                   cwd=work, env=env, stdout=stream, stderr=subprocess.STDOUT)
        base = 'http://127.0.0.1:' + str(port)
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                assert process.poll() is None, log.read_text(errors='replace')
                try:
                    if http(base, '/api/health')[0] == 200:
                        break
                except (urllib.error.URLError, TimeoutError, ConnectionError):
                    pass
                time.sleep(.1)
            else:
                raise AssertionError('Installed CLI did not become ready: ' + log.read_text(errors='replace'))
            yield base, process
        finally:
            stop(process)


def open_workspace(base, path):
    result = answer(base, '/api/workspaces/open', envelope('open_workspace_request', path=str(path)), 'workspace_answer')
    assert Path(result['path']).resolve() == path.resolve() and result['writable'] is True
    return result


def evidence(base, workspace, identity, case):
    result = answer(base, '/api/investigations/case-evidence', envelope('imported_case_evidence_request', workspace_id=workspace['workspace_id'], identity=identity, case_id=case), 'imported_case_evidence_answer')
    assert result['identity'] == identity and result['case_id'] == case
    return result


def graph(base, workspace, identity):
    result = answer(base, '/api/investigations/process-graph', envelope('process_graph_request', workspace_id=workspace['workspace_id'], identity=identity), 'process_graph_answer')
    assert result['identity'] == identity
    assert result['graph']['meta']['boundary_policy'] == 'incident.boundary.raw_labeled_start_end.v1'
    return result['graph']



def population_views(base, workspace, identity, parent_identity):
    opening = answer(base, '/api/investigations/opening-context', envelope('opening_context_request',
        workspace_id=workspace['workspace_id'], identity=identity), 'opening_context_answer')
    variants = answer(base, '/api/investigations/variants', envelope('variants_request',
        workspace_id=workspace['workspace_id'], identity=identity), 'variants_answer')
    for result in (opening, variants):
        assert result['schema_version'] == 1 and result['identity'] == identity
    assert opening['parent_identity'] == parent_identity
    profile = opening['opening_context']
    assert profile['anchor_policy'] == CONTEXT
    assert profile['population'] == {'case_count': 1, 'evaluable_case_count': 1,
        'unevaluable_case_count': 0, 'unevaluable_case_ids': []}
    assert profile['parent'] == {'case_count': 2, 'evaluable_case_count': 2,
        'unevaluable_case_count': 0, 'unevaluable_case_ids': []}
    assert len(profile['columns']) == 1
    column = profile['columns'][0]
    assert column['column_index'] == 4 and column['column_name'] == 'Desk'
    assert column['distinct_value_count'] == 2 and column['remainder'] is None
    assert len(column['categories']) == 2
    categories = {category['value']: category for category in column['categories']}
    assert categories == {
        'East': {'kind': 'value', 'value': 'East', 'population': {'count': 1, 'share': 1, 'denominator': 1},
                 'parent': {'count': 1, 'share': .5, 'denominator': 2}, 'difference_percentage_points': 50},
        'West': {'kind': 'value', 'value': 'West', 'population': {'count': 0, 'share': 0, 'denominator': 1},
                 'parent': {'count': 1, 'share': .5, 'denominator': 2}, 'difference_percentage_points': -50},
    }
    assert variants['variants'] == {
        'activity_projection_policy': 'incident.activity.omit_missing_retain_raw_gaps.v1',
        'case_count': 1, 'record_count': 4, 'omitted_activity_record_count': 1,
        'sequence_evaluable_case_count': 1, 'variant_count': 1,
        'variants': [{'id': 'variant.v1:sha256:44ce406f10bfd4b827626aa3b60041e4a8ddca143082a35b5b58fd3a0c6d5447',
            'activities': ['Recorded', 'Routed', 'Reviewed'], 'case_count': 1, 'share': 1,
            'denominator': 1, 'case_ids': ['T-01'], 'record_count': 4, 'omitted_activity_record_count': 1}],
        'unevaluable': {'case_ids': [], 'case_count': 0, 'record_count': 0, 'omitted_activity_record_count': 0},
    }
    return opening, variants

def imported(base, workspace, raw, filename, delimiter=';', sequence=3, context=4, cutoff='2027-01-01T00:00:00Z'):
    meta = envelope('upload_source_metadata', workspace_id=workspace['workspace_id'], filename=filename)
    status, body = http(base, '/api/sources', raw=raw, query=meta)
    assert 200 <= status < 300, (status, body)
    source = json.loads(body)['source']
    assert source == {'source_id': 'source.v1:sha256:' + hashlib.sha256(raw).hexdigest(), 'filename': filename, 'byte_count': len(raw)}
    request = envelope('confirm_mapping_request', workspace_id=workspace['workspace_id'], source_id=source['source_id'],
                       dialect={'encoding': 'utf-8', 'delimiter': delimiter, 'quotechar': '"', 'header': 'first_record'},
                       mapping={'case_column': 0, 'activity_column': 1, 'timestamp_column': 2, 'sequence_column': sequence, 'context_columns': [context]},
                       policies=b_policies(cutoff), accept_report_issues=True)
    before_proposal = open_workspace(base, Path(workspace['path']))
    proposed = answer(base, '/api/preparations/cutoff-proposal', request, 'cutoff_proposal_answer')
    assert proposed['schema_version'] == 1 and proposed['source_id'] == source['source_id']
    assert proposed['timestamp_kind'] == 'utc_instant'
    for field in ('last_usable_time', 'proposed_cutoff'):
        assert isinstance(proposed[field], str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z', proposed[field])
    if filename == 'B4-ties-out-of-order.csv':
        assert proposed['last_usable_time'] == proposed['proposed_cutoff'] == '2026-10-09T11:00:00Z'
    after_proposal = open_workspace(base, Path(workspace['path']))
    assert before_proposal['workspace_id'] == after_proposal['workspace_id'] == workspace['workspace_id']
    for field in ('sources', 'preparations'):
        assert after_proposal[field] == before_proposal[field]
    # A suggestion never publishes an interpretation or replaces the chosen cutoff.
    assert request['policies']['time']['parameters']['snapshot_cutoff_utc'] == cutoff
    prepared = answer(base, '/api/preparations', request, 'interpretation_answer')
    assert prepared['state'] == 'ready' and prepared['preparation']['source_id'] == source['source_id']
    for field in ('mapping', 'policies', 'dialect'):
        assert prepared['preparation'][field] == request[field]
    population = answer(base, '/api/investigations/open-population', envelope('open_population_request', workspace_id=workspace['workspace_id'], preparation_id=prepared['preparation']['preparation_id']), 'imported_population_answer')
    assert population['preparation'] == prepared['preparation']
    return source, prepared, population


def selected(base, workspace, population, predicates, parent):
    return answer(base, '/api/investigations/select-cases', envelope('select_cases_request', workspace_id=workspace['workspace_id'], identity=population['identity'], parent_case_ids=parent, predicates=predicates), 'selection_answer')


def period_definition():
    return {'target': {'name': 'Starts at nine', 'window': {'timestamp_kind': 'utc_instant',
                'start_inclusive': '2026-10-09T09:00:00Z', 'end_exclusive': '2026-10-09T10:00:00Z'}},
            'reference': {'name': 'Starts at eleven', 'window': {'timestamp_kind': 'utc_instant',
                'start_inclusive': '2026-10-09T11:00:00Z', 'end_exclusive': '2026-10-09T12:00:00Z'}},
            'minimum_followup_hours': 1, 'endpoint_activity': None}


def actual_examples(base, spec, wheel):
    with ZipFile(wheel) as archive:
        for name in archive.namelist():
            if name.startswith('wise_platform_api/static/') and not name.endswith('/'):
                status, data = http(base, '/' if name.endswith('/index.html') else '/' + name.removeprefix('wise_platform_api/static/'))
                assert status == 200 and data == archive.read(name), name
        receipts = []
        for example, case_ids in [('S0', ['INC02']), ('S1', ['INC05']), ('S2', ['S2B']), ('S3', ['S3A', 'S3B'])]:
            raw = archive.read('wise_platform_api/examples/' + example + '.csv')
            req = envelope('open_example_request', example_id=example, policies=spec['example_policies'])
            population = answer(base, '/api/investigations/open-example', req, 'population_answer')
            assert population['source']['synthetic'] is True
            assert population['identity']['source_id'] == 'source.v1:sha256:' + hashlib.sha256(raw).hexdigest()
            literal = spec['example_literals'][example]
            if example in ('S0', 'S1'):
                assert population['populations']['base']['case_count'] == literal['base_cases']
                assert population['populations']['base']['record_count'] == literal['base_records']
            original = list(csv.DictReader(io.StringIO(raw.decode(), newline='')))
            for case in case_ids:
                trace = answer(base, '/api/investigations/case-evidence', envelope('case_evidence_request', identity=population['identity'], case_id=case), 'case_evidence_answer')
                positions = [4, 5, 7, 6] if case == 'S2B' else [i for i, row in enumerate(original) if row['incident_id'] == case]
                assert [r['source_position'] for r in trace['records']] == positions
                assert [r['original_values'] for r in trace['records']] == [original[i] for i in positions]
                assert trace['identity'] == population['identity']
            receipts.append({'example': example, 'source_sha256': hashlib.sha256(raw).hexdigest(), 'evidence_cases': case_ids})
    return receipts


def scoring(base, workspace, bundle, definition):
    raw = (bundle / 'synthetic-inputs/first-resolution.csv').read_bytes()
    _, _, population = imported(base, workspace, raw, 'first-resolution.csv', delimiter=',', sequence=None, context=3, cutoff='2026-10-09T00:00:00Z')
    validation = answer(base, '/api/expectations/validate', envelope('validate_expectation_request', workspace_id=workspace['workspace_id'], base_identity=population['identity'], named_population={'name': 'Synthetic score proof', 'identity': population['identity']}, definition=definition), 'expectation_validation_answer')
    assert validation['state'] == 'ready' and validation['blockers'] == []
    version = validation['definition_version']
    run = answer(base, '/api/expectations/score', envelope('score_expectation_request', workspace_id=workspace['workspace_id'], base_identity=population['identity'], named_population={'name': 'Synthetic score proof', 'identity': population['identity']}, definition_version_id=version['definition_version_id']), 'score_run_answer')['run']
    assert run['identity']['calibration_id'] == run['calibration']['calibration_id']
    assert run['calibration']['population_fitted'] is False
    assert run['identity']['norm_fingerprint'] == version['norm']['norm_fingerprint']
    assert {c['case_id']: c['value'] for c in run['cases']} == {'D3': 0, 'D4': 0, 'D5': .5, 'D6': 1, 'GAP': .5, 'MISSING': None, 'NOOPEN': None, 'REOPEN': 0, 'TIED': 0}
    witness = answer(base, '/api/expectations/case-witness', envelope('score_case_witness_request', workspace_id=workspace['workspace_id'], run_id=run['identity']['run_id'], case_id='REOPEN'), 'score_case_witness_answer')
    assert witness['run_identity'] == run['identity']
    assert witness['case']['measurement']['value'] == 3 and len(witness['trace']['records']) == 4
    assert witness['trace']['records'] == evidence(base, workspace, population['identity'], 'REOPEN')['records']
    return {'run_id': run['identity']['run_id'], 'calibration_id': run['identity']['calibration_id'], 'first_response_days': 3, 'complete_witness_rows': 4}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--spec', type=Path, required=True); parser.add_argument('--receipt', type=Path, required=True)
    args = parser.parse_args(); spec = json.loads(args.spec.read_text()); bundle = Path(spec['bundle']); env = Path(spec['runtime_env']).resolve(); features = spec['features']
    assert sys.flags.isolated == 1
    import wise_platform_api, wise_platform_analytics
    for package in (wise_platform_api, wise_platform_analytics):
        location = Path(package.__file__).resolve()
        assert location.is_relative_to(env) and 'site-packages' in location.parts
    assert not any(env.glob('**/*.egg-link')) and not any(env.glob('**/__editable__*'))
    wheel = next((bundle / 'wheelhouse').glob('wise_platform-*.whl'))
    with tempfile.TemporaryDirectory(prefix='wise-installed-proof-') as temporary:
        work = Path(temporary); workspace_path = work / 'Überprüfung Workspace'; workspace_path.mkdir()
        with socket.socket() as reserved:
            reserved.bind(('127.0.0.1', 0)); port = reserved.getsockname()[1]
        with host(work, 1, port) as (base, first):
            examples = actual_examples(base, spec, wheel)
            workspace = open_workspace(base, workspace_path)
            raw = (bundle / 'synthetic-inputs/B4-ties-out-of-order.csv').read_bytes()
            assert hashlib.sha256(raw).hexdigest() == '46d7a88dd6544d8f5c8242b9a0cfc579e214c9c3f69130708f23769469adbc14'
            source, preparation, population = imported(base, workspace, raw, 'B4-ties-out-of-order.csv', cutoff=B4_CUTOFF)
            assert population['population'] == {'case_ids': ['T-01', 'T-02'], 'case_count': 2, 'record_count': 5}
            predicates = [{'kind': 'contains_activity', 'activity': 'Recorded', 'negate': False}, {'kind': 'directly_follows', 'source_activity': 'Recorded', 'target_activity': 'Routed', 'negate': False}]
            selection = selected(base, workspace, population, predicates, ['T-01', 'T-02'])
            assert selection['kept'] == {'case_ids': ['T-01'], 'case_count': 1, 'record_count': 4}
            assert selection['removed'] == {'case_ids': ['T-02'], 'case_count': 1, 'record_count': 1} and selection['unevaluable']['case_count'] == 0
            trace = evidence(base, workspace, selection['identity'], 'T-01')
            original = list(csv.reader(io.StringIO(raw.decode(), newline=''), delimiter=';'))[1:]
            assert [r['source_position'] for r in trace['records']] == [1, 2, 3, 0]
            assert [r['original_cells'] for r in trace['records']] == [original[i] for i in [1, 2, 3, 0]]
            assert trace['records'][2]['activity'] is None and trace['records'][2]['context'] == [{'column_index': 4, 'value': 'Unknown'}]
            for field in ('source_id', 'preparation_id', 'representation_id', 'case_dictionary_id', 'implementation_version'):
                assert selection['parent_identity'][field] == population['identity'][field]
            before_views = population_views(base, workspace, selection['identity'], selection['parent_identity'])
            before_graph = graph(base, workspace, selection['identity'])
            assert len(before_graph['edges']) == 2 and before_graph['meta']['raw_record_count'] == 4
            comparison, periods, saved = None, None, None
            comparison_cohorts = {}
            if 'comparison' in features:
                definition = {'mode': 'two_named_groups', 'target': {'name': 'Target', 'definition': {'kind': 'explicit_case_ids', 'case_ids': ['T-01']}}, 'reference': {'name': 'Reference', 'definition': {'kind': 'explicit_case_ids', 'case_ids': ['T-02']}}}
                comparison = answer(base, '/api/investigations/compare-groups', envelope('compare_groups_request', workspace_id=workspace['workspace_id'], identity=population['identity'], parent_case_ids=['T-01', 'T-02'], context_column_index=4, context_policy=CONTEXT, definition=definition), 'group_comparison_answer')
                assert comparison['target']['included'] == selection['kept'] and comparison['reference']['included'] == selection['removed']
                for role, case_id, expected_rows in [('target', 'T-01', 4), ('reference', 'T-02', 1)]:
                    cohort_identity = comparison[role]['identity']
                    cohort_trace = evidence(base, workspace, cohort_identity, case_id)
                    assert len(cohort_trace['records']) == expected_rows
                    comparison_cohorts[role] = {'identity': cohort_identity, 'case_id': case_id,
                        'trace': cohort_trace, 'graph': graph(base, workspace, cohort_identity)}
                periods = answer(base, '/api/investigations/compare-periods', envelope('compare_periods_request', workspace_id=workspace['workspace_id'], identity=population['identity'], parent_case_ids=['T-01', 'T-02'], context_column_index=4, context_policy=CONTEXT, definition=period_definition()), 'period_comparison_answer')
                assert periods['target']['included'] == {'case_ids': ['T-01'], 'case_count': 1, 'record_count': 4}
                assert periods['reference']['included'] == {'case_ids': ['T-02'], 'case_count': 1, 'record_count': 1}
                for role, case_id, followup in [('target', 'T-01', 3), ('reference', 'T-02', 1)]:
                    assert {c['case_id']: c['followup_hours'] for c in periods[role]['exposure']['cases']} == {case_id: followup}
                    period_trace = evidence(base, workspace, periods[role]['identity'], case_id)
                    assert period_trace['records'] == comparison_cohorts[role]['trace']['records']
                    period_graph = graph(base, workspace, periods[role]['identity'])
                    assert period_graph['meta']['raw_record_count'] == periods[role]['included']['record_count']
                # The target window ends at ten; its three later/tied source rows
                # remain in the complete case despite falling outside that window.
                assert comparison_cohorts['target']['trace']['records'][-1]['utc_instant'] == period_definition()['target']['window']['end_exclusive']
            if 'saving' in features:
                bookmarks = [{'label': 'Complete incident', 'identity': selection['identity'], 'case_id': 'T-01', 'row_ids': [], 'note': 'Keep all original rows.'}, {'label': 'Missing activity', 'identity': selection['identity'], 'case_id': 'T-01', 'row_ids': [trace['records'][2]['row_id']], 'note': 'Unknown is a literal context value.'}]
                save_request = envelope('save_investigation_request', workspace_id=workspace['workspace_id'], investigation_id=None, expected_revision_id=None, name='Übergabe synthetic', base_identity=population['identity'], selection_identity=selection['identity'], selection_recipe={'parent_case_ids': ['T-01', 'T-02'], 'predicates': predicates}, context_policy=CONTEXT, comparison={'kind': 'group', 'comparison_id': comparison['comparison_id'], 'parent_case_ids': ['T-01', 'T-02'], 'context_column_index': 4, 'context_policy': CONTEXT, 'definition': definition}, notes='Synthetic only.\nPreserve complete evidence.', bookmarks=bookmarks)
                saved = answer(base, '/api/investigations/save', save_request, 'save_investigation_answer')['revision']
                for key in ('notes', 'bookmarks', 'selection_recipe', 'base_identity', 'selection_identity', 'comparison'):
                    assert saved['content'][key] == save_request[key]
                assert saved['content']['score_run_ref'] is None
            scored = scoring(base, workspace, bundle, spec['scoring_definition']) if 'scoring' in features else None
        assert first.poll() is not None
        with host(work, 2, port) as (base, second):
            assert first.pid != second.pid
            reopened_workspace = open_workspace(base, workspace_path)
            assert reopened_workspace['workspace_id'] == workspace['workspace_id']
            assert source in reopened_workspace['sources']
            assert {key: preparation['preparation'][key] for key in ('preparation_id', 'source_id')} in reopened_workspace['preparations']
            if saved:
                restored = answer(base, '/api/investigations/reopen', envelope('reopen_investigation_request', workspace_id=workspace['workspace_id'], saved_revision_id=saved['saved_revision_id']), 'reopen_investigation_answer')
                assert restored['revision'] == saved and restored['restored_comparison_id'] == comparison['comparison_id']
                for field in ('identity', 'parent_identity', 'parent', 'kept', 'removed', 'unevaluable', 'predicate_results'):
                    assert restored['restored_selection'][field] == selection[field]
                # Real evidence and graph occur before any second-process population/select/compare query.
                identity = restored['restored_selection']['identity']
            else:
                restored_base = answer(base, '/api/investigations/open-population', envelope('open_population_request', workspace_id=workspace['workspace_id'], preparation_id=preparation['preparation']['preparation_id']), 'imported_population_answer')
                assert restored_base['identity'] == population['identity']
                identity = selected(base, workspace, restored_base, predicates, ['T-01', 'T-02'])['identity']
                assert identity == selection['identity']
            after_trace = evidence(base, reopened_workspace, identity, 'T-01')
            for field in ('identity', 'case_id', 'columns', 'records', 'coverage', 'mapped_row_ids', 'omitted_activity_row_ids', 'sequence_evaluable'):
                assert after_trace[field] == trace[field]
            assert graph(base, reopened_workspace, identity) == before_graph
            # In the saved branch these calls precede any fresh base/select/compare query.
            assert population_views(base, reopened_workspace, identity, selection['parent_identity']) == before_views
            if saved:
                # BOTH comparison cohort identities must be restored, including
                # the target's empty selection recipe, before any fresh queries.
                for cohort in comparison_cohorts.values():
                    restored_trace = evidence(base, reopened_workspace, cohort['identity'], cohort['case_id'])
                    for field in ('identity', 'case_id', 'columns', 'records', 'coverage', 'mapped_row_ids', 'omitted_activity_row_ids', 'sequence_evaluable'):
                        assert restored_trace[field] == cohort['trace'][field]
                    assert graph(base, reopened_workspace, cohort['identity']) == cohort['graph']
                # Verify stored preparation meaning after all restoration-only
                # calls, so this population query cannot repair a missing registry.
                restored_base = answer(base, '/api/investigations/open-population', envelope('open_population_request', workspace_id=workspace['workspace_id'], preparation_id=preparation['preparation']['preparation_id']), 'imported_population_answer')
            assert restored_base['identity'] == population['identity']
            assert restored_base['preparation'] == preparation['preparation']
        assert second.poll() is not None
    receipt = {'all_passed': True, 'features': features, 'scope': 'Installed noneditable wheel on this runner; not Windows 11 human download/browser qualification',
               'isolated_python': True, 'checkout_paths_removed': True, 'real_owned_processes': 2, 'both_processes_stopped': True,
               'examples': examples, 'imported_source_sha256': hashlib.sha256(raw).hexdigest(), 'complete_selected_rows': 4,
               'preserved_missing_activity': True, 'preparation_equal_after_restart': True,
               'cutoff_proposal_checked': True, 'cutoff_proposal_persisted_state_unchanged': True, 'b4_proposed_cutoff_utc': '2026-10-09T11:00:00Z',
               'opening_context_checked': True, 'variants_checked': True, 'population_views_equal_after_restart': True,
               'saved_revision_reopened': bool(saved), 'saved_comparison_cohorts_restored': 2 if saved else 0,
               'period_comparison_checked': periods is not None, 'b4_cutoff_utc': B4_CUTOFF,
               'period_cohort_case_ids': None if periods is None else {r: periods[r]['included']['case_ids'] for r in ('target', 'reference')},
               'scoring': scored}
    args.receipt.write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'all_passed': True, 'features': features, 'real_owned_processes': 2}))


if __name__ == '__main__':
    main()
