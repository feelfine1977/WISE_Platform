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
        process = subprocess.Popen([sys.executable, '-I', '-m', 'wise_platform_api', '--host', '127.0.0.1', '--port', str(port),
                                    '--workspace', str(work / 'Überprüfung Workspace')],
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


def initialize_workspace(base, path):
    result = answer(base, '/api/workspaces/open-default', envelope('open_default_workspace_request'), 'workspace_answer')
    assert Path(result['path']).resolve() == path.resolve() and result['writable'] is True
    return result


def evidence(base, workspace, identity, case):
    result = answer(base, '/api/investigations/case-evidence', envelope('imported_case_evidence_request', workspace_id=workspace['workspace_id'], identity=identity, case_id=case), 'imported_case_evidence_answer')
    assert result['identity'] == identity and result['case_id'] == case
    assert isinstance(result.get('incident_time'), dict), 'Installed case evidence must supply incident_time.'
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
    read = answer(base, '/api/expectations/read-run', envelope('read_score_run_request', workspace_id=workspace['workspace_id'], run_id=run['identity']['run_id']), 'score_run_answer')
    assert read['run'] == run
    return ({'run_id': run['identity']['run_id'], 'calibration_id': run['identity']['calibration_id'], 'first_response_days': 3, 'complete_witness_rows': 4},
            {'population': population, 'run': run, 'witness': witness})


def save_scored_question(base, workspace, proof):
    population, run = proof['population'], proof['run']
    predicates = [{'kind': 'contains_activity', 'activity': 'Opened', 'negate': False}]
    selection = selected(base, workspace, population, predicates, population['population']['case_ids'])
    assert selection['kept']['case_count'] == 8 and selection['removed']['case_ids'] == ['NOOPEN']
    reference = {'score_run_id': run['identity']['run_id'],
                 'scored_population_id': run['identity']['scored_population_identity']['population_id'],
                 'calibration_id': run['identity']['calibration_id']}
    request = envelope('save_investigation_request', workspace_id=workspace['workspace_id'], investigation_id=None, expected_revision_id=None,
                       name='Original scores on eight incidents', base_identity=population['identity'], selection_identity=selection['identity'],
                       selection_recipe={'parent_case_ids': population['population']['case_ids'], 'predicates': predicates},
                       context_policy=CONTEXT, comparison=None, notes='Keep the original nine-incident run without fitting or scoring the eight-incident selection.',
                       bookmarks=[], score_run_ref=reference)
    saved = answer(base, '/api/investigations/save', request, 'save_investigation_answer')['revision']
    assert saved['content']['score_run_ref'] == reference
    return {'revision': saved, 'selection': selection}


def workspace_bytes(workspace):
    root = Path(workspace['path'])
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file()}


def recorded_route_checks(base, workspace, prior=None):
    """Literal full-RAW/frozen-parent checks; reopen before any fresh selection."""
    raw = b"""case,activity,at,seq,Desk
G,Open,2026-10-01T00:00:00Z,1,East
G,,2026-10-01T01:00:00Z,2,East
G,Close,2026-10-01T04:00:00.000001Z,3,West
Z,Zero,2026-10-01T02:00:00Z,1,West
Z,Zero,2026-10-01T02:00:00Z,2,West
S,Open,2026-10-01T03:00:00Z,1,East
U,Unknown,2026-10-01T05:00:00Z,1,East
U,Untimed,,2,East
X,Outside,2026-09-30T00:00:00Z,1,West
X,Outside,2026-10-03T00:00:00Z,2,West
"""
    parent = ['G', 'S', 'U', 'Z']
    counts, proofs = {}, []

    def ask(route, request, kind, preview=True):
        before = workspace_bytes(workspace) if preview else None
        result = answer(base, route, request, kind)
        counts[route] = counts.get(route, 0) + 1
        if preview:
            assert workspace_bytes(workspace) == before, (route, 'Preview wrote durable files.')
        return result

    def selection(identity, predicates):
        return ask('/api/investigations/select-cases', envelope('select_cases_request',
            workspace_id=workspace['workspace_id'], identity=identity,
            parent_case_ids=parent, predicates=predicates), 'selection_answer')

    def refused(identity, predicates, code):
        request = envelope('select_cases_request', workspace_id=workspace['workspace_id'],
            identity=identity, parent_case_ids=parent, predicates=predicates)
        before = workspace_bytes(workspace)
        status, body = http(base, '/api/investigations/select-cases', request)
        refusal = json.loads(body)
        assert status == 422 and refusal['message_type'] == 'selection_refusal'
        assert refusal['code'] == code and refusal['request_id'] == request['request_id']
        assert refusal['workspace_id'] == workspace['workspace_id']
        assert workspace_bytes(workspace) == before
        counts['/api/investigations/select-cases:refusal'] = counts.get('/api/investigations/select-cases:refusal', 0) + 1

    for wall in (False, True):
        stamp = lambda value: value.removesuffix('Z') if wall else value
        kind = 'wall_clock' if wall else 'utc_instant'
        current_raw = re.sub(rb'(T\d\d:\d\d:\d\d(?:\.\d+)?)Z,', rb'\1,', raw) if wall else raw
        original = list(csv.reader(io.StringIO(current_raw.decode(), newline='')))[1:]
        edges = [stamp('2026-10-01T00:00:00Z'), stamp('2026-10-01T02:00:00Z'), stamp('2026-10-01T04:00:00Z')]
        predicates = [
            {'kind': 'case_id_in', 'case_ids': ['G', 'Z'], 'negate': False},
            {'kind': 'case_start_in_window', 'window': {'timestamp_kind': kind,
                'start_inclusive': edges[0], 'end_exclusive': edges[1]}, 'negate': False},
            {'kind': 'opening_attribute_in', 'column_index': 4, 'values': ['East'], 'anchor_policy': CONTEXT, 'negate': False},
            {'kind': 'record_attribute_in', 'column_index': 4, 'values': ['West'], 'negate': False},
            {'kind': 'observed_span_at_least', 'hours': 1, 'negate': False},
            {'kind': 'max_raw_gap_at_least', 'hours': 1, 'negate': False},
        ]
        if prior is None:
            metadata = envelope('upload_source_metadata', workspace_id=workspace['workspace_id'], filename=kind + '-recorded-routes.csv')
            status, body = http(base, '/api/sources', raw=current_raw, query=metadata)
            assert status == 200
            counts['/api/sources'] = counts.get('/api/sources', 0) + 1
            source = json.loads(body)['source']
            assert source['source_id'] == 'source.v1:sha256:' + hashlib.sha256(current_raw).hexdigest()
            policies = b_policies('2026-10-04T00:00:00Z')
            if wall:
                policies['time'] = {'id': 'incident.time.wall_clock_as_recorded.v1', 'parameters':
                    {'format': 'iso8601', 'timezone': 'none_as_recorded', 'snapshot_cutoff_local': '2026-10-04T00:00:00'}}
            prepared = ask('/api/preparations', envelope('confirm_mapping_request', workspace_id=workspace['workspace_id'],
                source_id=source['source_id'], dialect={'encoding': 'utf-8', 'delimiter': ',', 'quotechar': '"', 'header': 'first_record'},
                mapping={'case_column': 0, 'activity_column': 1, 'timestamp_column': 2, 'sequence_column': 3, 'context_columns': [4]},
                policies=policies, accept_report_issues=True), 'interpretation_answer', preview=False)
            assert prepared['state'] == 'ready'
            population = ask('/api/investigations/open-population', envelope('open_population_request',
                workspace_id=workspace['workspace_id'], preparation_id=prepared['preparation']['preparation_id']), 'imported_population_answer')
            assert population['population'] == {'case_ids': ['G', 'S', 'U', 'X', 'Z'], 'case_count': 5, 'record_count': 10}
            expected = [(['G', 'Z'], []), (['G'], ['U']), (['G', 'S'], ['U']),
                        (['G', 'Z'], []), (['G'], ['U']), (['G'], ['S', 'U'])]
            for predicate, (kept, unknown) in zip(predicates, expected):
                result = selection(population['identity'], [predicate])
                assert result['kept']['case_ids'] == kept and result['unevaluable']['case_ids'] == unknown
                assert result['parent'] == {'case_ids': parent, 'case_count': 4, 'record_count': 8}
            full = selection(population['identity'], [])
            chosen = selection(population['identity'], predicates)
            assert chosen['kept'] == {'case_ids': ['G'], 'case_count': 1, 'record_count': 3}
            assert chosen['removed'] == {'case_ids': ['S', 'U', 'Z'], 'case_count': 3, 'record_count': 5}
            assert chosen['unevaluable']['case_ids'] == []  # False dominates U in the conjunction.
            refused(population['identity'], [{'kind': 'case_id_in', 'case_ids': ['X'], 'negate': False}], 'case_outside_parent')
            other = deepcopy(predicates[1]); other['window'] = {'timestamp_kind': 'utc_instant' if wall else 'wall_clock',
                'start_inclusive': '2026-10-01T00:00:00Z' if wall else '2026-10-01T00:00:00',
                'end_exclusive': '2026-10-01T02:00:00Z' if wall else '2026-10-01T02:00:00'}
            refused(population['identity'], [other], 'invalid_predicate')
        else:
            before = prior[wall]
            restored = ask('/api/investigations/reopen', envelope('reopen_investigation_request',
                workspace_id=workspace['workspace_id'], saved_revision_id=before['saved']['saved_revision_id']), 'reopen_investigation_answer', preview=False)
            assert restored['revision'] == before['saved']
            chosen = restored['restored_selection']
            for field in ('identity', 'parent_identity', 'parent', 'kept', 'removed', 'unevaluable', 'predicate_results'):
                assert chosen[field] == before['selection'][field]
            full = {'identity': chosen['parent_identity']}
        # These are the complete parent histories, before any second-process population/select call.
        traces = {}
        for case, positions in [('G', [0, 1, 2]), ('S', [5]), ('U', [6, 7]), ('Z', [3, 4])]:
            trace = ask('/api/investigations/case-evidence', envelope('imported_case_evidence_request',
                workspace_id=workspace['workspace_id'], identity=full['identity'], case_id=case), 'imported_case_evidence_answer')
            assert trace['identity'] == full['identity'] and trace['case_id'] == case
            assert [r['source_position'] for r in trace['records']] == positions
            assert [r['original_cells'] for r in trace['records']] == [original[i] for i in positions]
            diag = trace.get('incident_time')
            assert isinstance(diag, dict), 'Installed case evidence must supply incident_time.'
            assert diag['policy_id'] == 'incident.time_diagnostics.full_raw_declared_order.v1'
            assert diag['timestamp_kind'] == kind
            assert diag['duration_basis'] == ('recorded_wall_clock' if wall else 'elapsed_utc')
            assert diag['clock_limitation'] == ('recorded_wall_duration_may_differ_from_physical_elapsed' if wall else None)
            assert [r['row_id'] for r in diag['records']] == [r['row_id'] for r in trace['records']]
            offsets = {'G': [0, 3600000000, 14400000001], 'S': [0], 'U': [None, None], 'Z': [0, 0]}[case]
            for index, row in enumerate(diag['records']):
                assert row['offset_from_first_record_microseconds'] == (None if offsets[index] is None else str(offsets[index]))
                timestamp = trace['records'][index]['local_timestamp' if wall else 'utc_instant']
                assert row['timestamp_key'] == timestamp == (original[positions[index]][2] or None)
                absolute = {'G': [1790812800000000, 1790816400000000, 1790827200000001],
                            'S': [1790823600000000], 'U': [1790830800000000, None], 'Z': [1790820000000000, 1790820000000000]}[case][index]
                assert row['clock_microseconds'] == (None if absolute is None else str(absolute))
                gap = row['gap_before']
                if case == 'U' or index == 0:
                    assert gap == {'status': 'unavailable', 'reason': 'order_unknown' if case == 'U' else 'first_record',
                                   'from_row_id': None, 'microseconds': None, 'hours': None}
                else:
                    expected_gap = {'G': [3600000000, 10800000001], 'Z': [0]}[case][index - 1]
                    assert gap['status'] == 'available' and gap['microseconds'] == str(expected_gap)
                    assert gap['hours'] == ({3600000000: 1, 10800000001: 3.000000000277778, 0: 0}[expected_gap])
                    assert gap['from_row_id'] == trace['records'][index - 1]['row_id']
            assert diag['observed_span_microseconds'] == {'G': '14400000001', 'S': '0', 'U': None, 'Z': '0'}[case]
            assert diag['maximum_adjacent_raw_gap_microseconds'] == {'G': '10800000001', 'S': None, 'U': None, 'Z': '0'}[case]
            assert diag['maximum_gap_equal_count'] == {'G': 1, 'S': None, 'U': None, 'Z': 1}[case]
            summary = diag['summary']
            if case == 'U':
                assert summary['status'] == 'unavailable' and summary['reason'] == 'order_unknown'
                assert summary['unavailable_timestamp_record_count'] == 1 and summary['maximum_gap_witness'] is None
            else:
                assert summary['status'] == 'available'
                assert summary['usable_gap_count'] == {'G': 2, 'S': 0, 'Z': 1}[case]
                assert summary['maximum_adjacent_raw_gap_hours'] == {'G': 3.000000000277778, 'S': None, 'Z': 0}[case]
                assert summary['observed_span_hours'] == {'G': 4.000000000277778, 'S': 0, 'Z': 0}[case]
                assert summary['maximum_adjacent_raw_gap_unavailable_reason'] == ('fewer_than_two_records' if case == 'S' else None)
                witness = summary['maximum_gap_witness']
                if case == 'S':
                    assert witness is None
                else:
                    left, right = (1, 2) if case == 'G' else (0, 1)
                    assert witness['from_row_id'] == trace['records'][left]['row_id'] and witness['to_row_id'] == trace['records'][right]['row_id']
                    assert witness['from_activity'] == trace['records'][left]['activity']
                    assert witness['to_activity'] == trace['records'][right]['activity']
                    assert witness['share_unavailable_reason'] == (None if case == 'G' else 'zero_observed_span')
            traces[case] = trace
        assert traces['G']['records'][1]['activity'] is None
        def views(identity):
            listed = ask('/api/investigations/case-list', envelope('case_list_request', workspace_id=workspace['workspace_id'],
                identity=identity, query={'search_text': None, 'sort': {'field': 'case_id', 'direction': 'ascending'}, 'offset': 0, 'limit': 20}), 'case_list_answer')
            trend = ask('/api/investigations/start-trend', envelope('start_trend_request', workspace_id=workspace['workspace_id'], identity=identity,
                definition={'policy_id': 'incident.start_trend.first_raw_declared_order_half_open.v1',
                            'binning': {'kind': 'explicit_edges', 'timestamp_kind': kind, 'edges': edges}}), 'start_trend_answer')
            groups = ask('/api/investigations/rule-groups', envelope('rule_groups_request', workspace_id=workspace['workspace_id'], identity=identity,
                query={'rule': {'kind': 'activity_presence', 'activity': 'Open'}, 'distribution_edges_hours': [0, 1, 5], 'offset': 0, 'limit': 20}), 'rule_groups_answer')
            assert all(result['identity'] == identity for result in (listed, trend, groups))
            assert trend['edges'] == edges and trend['parent_support'] == {'case_ids': parent, 'case_count': 4, 'record_count': 8}
            assert [b['parent_support']['case_ids'] for b in trend['bins']] == [['G'], ['S', 'Z']]
            assert trend['unevaluable']['parent_support']['case_ids'] == ['U']
            assert trend['clock'] == {'timestamp_kind': kind, 'snapshot_cutoff': stamp('2026-10-04T00:00:00Z')}
            assert groups['catalogue_scope'] == 'frozen_parent'
            assert groups['parent_identity'] == chosen['parent_identity']
            assert groups['parent_coverage']['total'] == {'case_count': 4, 'record_count': 8, 'omitted_activity_record_count': 1}
            assert trend['before_range']['parent_support']['case_ids'] == trend['after_range']['parent_support']['case_ids'] == []
            assert {g['key']['present']: g['parent']['cases']['case_count'] for g in groups['groups']} == {False: 2, True: 2}
            return {'case_list': listed, 'start_trend': trend, 'rule_groups': groups}
        current = views(chosen['identity'])
        selected_trace = ask('/api/investigations/case-evidence', envelope('imported_case_evidence_request',
            workspace_id=workspace['workspace_id'], identity=chosen['identity'], case_id='G'), 'imported_case_evidence_answer')
        assert selected_trace['identity'] == chosen['identity']
        assert selected_trace['records'] == traces['G']['records']
        assert selected_trace['incident_time'] == traces['G']['incident_time']
        assert [r['case_id'] for r in current['case_list']['rows']] == ['G']
        assert current['case_list']['rows'][0]['time_summary'] == traces['G']['incident_time']['summary']
        assert [b['kept_support']['case_ids'] for b in current['start_trend']['bins']] == [['G'], []]
        assert {g['key']['present']: g['population']['cases']['case_ids'] for g in current['rule_groups']['groups']} == {False: [], True: ['G']}
        if prior is None:
            baseline = views(full['identity'])
            assert [r['case_id'] for r in baseline['case_list']['rows']] == parent
            assert all(r['time_summary'] == traces[r['case_id']]['incident_time']['summary'] for r in baseline['case_list']['rows'])
            assert {g['key']['present']: g['population']['cases']['case_ids'] for g in baseline['rule_groups']['groups']} == {False: ['U', 'Z'], True: ['G', 'S']}
            assert [g['id'] for g in baseline['rule_groups']['groups']] == [g['id'] for g in current['rule_groups']['groups']]
            saved = ask('/api/investigations/save', envelope('save_investigation_request', workspace_id=workspace['workspace_id'],
                investigation_id=None, expected_revision_id=None, name=kind + ' recorded route proof', base_identity=population['identity'],
                selection_identity=chosen['identity'], selection_recipe={'parent_case_ids': parent, 'predicates': predicates},
                context_policy=CONTEXT, comparison=None, notes='Invented complete records; fixed parent.', bookmarks=[]), 'save_investigation_answer', preview=False)['revision']
            proofs.append({'selection': chosen, 'saved': saved, 'traces': traces, 'views': current})
        else:
            assert traces == before['traces'] and current == before['views']
    return proofs, counts


def next_service_checks(base, workspace, prior=None):
    """Literal passage totals, whole-case ranges and ordered-prefix HTTP proof."""
    raw = b"""case,activity,at,seq,Desk
SK,A,2026-10-01T00:00:00Z,1,East
SK,B,2026-10-01T01:00:00Z,2,East
SK,A,2026-10-01T02:00:00Z,3,East
SK,B,2026-10-01T03:00:00Z,4,East
SK,A,2026-10-01T04:00:00Z,5,East
SK,B,2026-10-05T06:00:00Z,6,West
BUSY,C,2026-10-01T00:00:00Z,1,East
BUSY,D,2026-10-01T20:00:00Z,2,East
BUSY,C,2026-10-01T21:00:00Z,3,East
BUSY,D,2026-10-02T17:00:00Z,4,East
BUSY,C,2026-10-02T18:00:00Z,5,East
BUSY,D,2026-10-03T14:00:00Z,6,West
RARE,E,2026-10-01T00:00:00Z,1,East
RARE,F,2026-10-04T08:00:00Z,2,West
BRIDGE,H,2026-10-01T00:00:00Z,1,East
BRIDGE,,2026-10-01T01:00:00Z,2,East
BRIDGE,I,2026-10-01T04:00:00.000001Z,3,West
SELF,J,2026-10-01T00:00:00Z,1,West
SELF,J,2026-10-01T00:00:00Z,2,West
SIDE,K,2026-10-01T00:00:00Z,1,East
SIDE,L,2026-10-01T03:00:00Z,2,West
U,A,2026-10-01T00:00:00Z,1,East
U,B,,2,West
SINGLE,S,2026-10-01T00:00:00Z,1,East
OUT,A,2026-10-01T00:00:00Z,1,East
OUT,B,2026-11-11T16:00:00Z,2,West
"""
    parent = ['BRIDGE', 'BUSY', 'RARE', 'SELF', 'SIDE', 'SINGLE', 'SK', 'U']
    sizes = dict(zip(parent, (3, 6, 2, 2, 2, 1, 6, 2)))
    positions = {'SK': [0, 1, 2, 3, 4, 5], 'BUSY': [6, 7, 8, 9, 10, 11], 'RARE': [12, 13],
                 'BRIDGE': [14, 15, 16], 'SELF': [17, 18], 'SIDE': [19, 20], 'U': [21, 22], 'SINGLE': [23]}
    # Rank and passage sums are literal expectations, including every repeat.
    paths = [('A', 'B', 360000000000, 3, 1, 1), ('E', 'F', 288000000000, 1, 1, 80),
             ('C', 'D', 216000000000, 3, 1, 20), ('H', 'I', 14400000001, 1, 1, 4.000000000277778),
             ('K', 'L', 10800000000, 1, 1, 3), ('B', 'A', 7200000000, 2, 1, 1),
             ('D', 'C', 7200000000, 2, 1, 1), ('J', 'J', 0, 1, 1, 0)]
    counts, proofs = {}, []

    def ask(route, request, kind, preview=True):
        before = workspace_bytes(workspace) if preview else None
        result = answer(base, route, request, kind)
        counts[route] = counts.get(route, 0) + 1
        if preview:
            assert workspace_bytes(workspace) == before, (route, 'Preview wrote durable files.')
        return result

    def support(ids):
        return {'case_ids': ids, 'case_count': len(ids), 'record_count': sum(sizes[case] for case in ids)}

    def partition(result, kept, unknown=()):
        assert result['kept'] == support(kept)
        assert result['unevaluable'] == support(list(unknown))
        assert result['removed'] == support([case for case in parent if case not in kept and case not in unknown])

    def pick(identity, predicates, active=None):
        fields = {} if active is None else {'active_step_count': active}
        result = ask('/api/investigations/select-cases', envelope('select_cases_request',
            workspace_id=workspace['workspace_id'], identity=identity, parent_case_ids=parent,
            predicates=predicates, **fields), 'selection_answer')
        assert result['parent'] == support(parent)
        assert result['active_step_count'] == (len(predicates) if active is None else active)
        assert len(result['step_results']) == len(result['predicate_results']) == len(predicates)
        for number, (step, predicate) in enumerate(zip(result['step_results'], predicates), 1):
            assert step['step_number'] == number and step['predicate'] == predicate
        return result

    def denied(identity, predicates, code='invalid_predicate', status=422, **fields):
        request = envelope('select_cases_request', workspace_id=workspace['workspace_id'], identity=identity,
                           parent_case_ids=parent, predicates=predicates, **fields)
        before = workspace_bytes(workspace)
        actual_status, body = http(base, '/api/investigations/select-cases', request)
        result = json.loads(body)
        assert actual_status == status and result['message_type'] == 'selection_refusal', (actual_status, result)
        assert result['code'] == code and result['operation'] == 'select_cases'
        for field in ('request_id', 'query_revision', 'workspace_id'):
            assert result[field] == request[field]
        assert workspace_bytes(workspace) == before
        counts['/api/investigations/select-cases:refusal'] = counts.get('/api/investigations/select-cases:refusal', 0) + 1

    def graph_proof(identity, expected_paths, cases):
        result = ask('/api/investigations/process-graph', envelope('process_graph_request',
            workspace_id=workspace['workspace_id'], identity=identity), 'process_graph_answer')
        assert result['identity'] == identity
        supplied = result['graph']
        assert supplied['meta']['selected_case_ids'] == cases
        edges = {(edge['payload']['source_activity'], edge['payload']['target_activity']): edge for edge in supplied['edges']}
        assert len(edges) == len(supplied['edges']) == len(expected_paths)
        assert set(edges) == {(source, target) for source, target, *_ in expected_paths}
        total = sum(item[2] for item in expected_paths)
        for source, target, ticks, passages, incidents, middle in expected_paths:
            edge = edges[source, target]
            assert edge['kind'] == 'follows'
            metrics = edge['metrics']
            assert type(metrics['count']) is type(metrics['usableLagCount']) is type(metrics['cases']) is int
            assert metrics['count'] == metrics['usableLagCount'] == passages and metrics['cases'] == incidents
            assert metrics['medianLagHours'] == middle
            assert metrics['totalLagMicroseconds'] == str(ticks)
            assert type(metrics['totalLagMicroseconds']) is str and re.fullmatch(r'0|[1-9][0-9]{0,63}', metrics['totalLagMicroseconds'])
            assert metrics['totalLagHours'] == ticks / 3600000000
            assert type(metrics['totalLagHours']) in (int, float)
            assert metrics['shareOfTotalLag'] == (ticks / total if total else None)
            assert metrics['shareOfTotalLag'] is None or type(metrics['shareOfTotalLag']) in (int, float)
        top = expected_paths[:5]
        assert supplied['meta']['path_lag_totals'] == {
            'total_hours': total / 3600000000, 'total_microseconds': str(total),
            'usable_passage_count': sum(item[3] for item in expected_paths), 'usable_path_count': len(expected_paths),
            'top_five_path_ids': [edges[source, target]['id'] for source, target, *_ in top],
            'top_five_total_hours': sum(item[2] for item in top) / 3600000000,
            'top_five_total_microseconds': str(sum(item[2] for item in top)),
            'top_five_share': sum(item[2] for item in top) / total if total else None}
        return supplied

    def measure(kind, low, high, negate=False):
        unit = 'records' if kind == 'raw_record_count_between' else 'hours'
        return {'kind': kind, 'minimum_' + unit: low, 'maximum_' + unit: high, 'negate': negate}

    def passage(source, target, low, high, quantifier='any', negate=False):
        return {**measure('directly_follows_lag_between', low, high, negate), 'source_activity': source,
                'target_activity': target, 'quantifier': quantifier}

    for wall in (False, True):
        kind = 'wall_clock' if wall else 'utc_instant'
        stamp = lambda value: value.removesuffix('Z') if wall else value
        current_raw = re.sub(rb'(T\d\d:\d\d:\d\d(?:\.\d+)?)Z,', rb'\1,', raw) if wall else raw
        original = list(csv.reader(io.StringIO(current_raw.decode(), newline='')))[1:]
        trail = [measure('raw_record_count_between', 2, 6), passage('A', 'B', 1, 1),
                 measure('raw_record_count_between', 3, 6), measure('observed_span_between', 0, 100)]

        def prepare_fixture(blob, name, cutoff='2026-12-01T00:00:00Z'):
            status, body = http(base, '/api/sources', raw=blob, query=envelope('upload_source_metadata',
                workspace_id=workspace['workspace_id'], filename=kind + '-' + name + '.csv'))
            assert status == 200
            counts['/api/sources'] = counts.get('/api/sources', 0) + 1
            source = json.loads(body)['source']
            assert source['source_id'] == 'source.v1:sha256:' + hashlib.sha256(blob).hexdigest()
            policies = b_policies(cutoff)
            if wall:
                policies['time'] = {'id': 'incident.time.wall_clock_as_recorded.v1', 'parameters':
                    {'format': 'iso8601', 'timezone': 'none_as_recorded', 'snapshot_cutoff_local': stamp(cutoff)}}
            prepared = ask('/api/preparations', envelope('confirm_mapping_request', workspace_id=workspace['workspace_id'],
                source_id=source['source_id'], dialect={'encoding': 'utf-8', 'delimiter': ',', 'quotechar': '"', 'header': 'first_record'},
                mapping={'case_column': 0, 'activity_column': 1, 'timestamp_column': 2, 'sequence_column': 3, 'context_columns': [4]},
                policies=policies, accept_report_issues=True), 'interpretation_answer', preview=False)
            assert prepared['state'] == 'ready'
            return ask('/api/investigations/open-population', envelope('open_population_request', workspace_id=workspace['workspace_id'],
                preparation_id=prepared['preparation']['preparation_id']), 'imported_population_answer')

        if prior is None:
            population = prepare_fixture(current_raw, 'service-slices')
            assert population['population'] == {'case_ids': ['BRIDGE', 'BUSY', 'OUT', 'RARE', 'SELF', 'SIDE', 'SINGLE', 'SK', 'U'],
                                                'case_count': 9, 'record_count': 26}
            full = pick(population['identity'], [])
            parent_graph = graph_proof(full['identity'], paths, parent)
            assert parent_graph['meta']['sequence_unevaluable_case_ids'] == ['U']
            assert parent_graph['meta']['lag_clock'] == ('recorded_wall_clock_hours' if wall else 'elapsed_utc_hours')
            subset = pick(population['identity'], [{'kind': 'case_id_in', 'case_ids': ['BRIDGE', 'SELF', 'SK', 'U'], 'negate': False}])
            graph_proof(subset['identity'], [paths[i] for i in (0, 3, 5, 7)], ['BRIDGE', 'SELF', 'SK', 'U'])
            zero = pick(population['identity'], [{'kind': 'case_id_in', 'case_ids': ['SELF'], 'negate': False}])
            graph_proof(zero['identity'], [paths[7]], ['SELF'])
            unavailable = pick(population['identity'], [{'kind': 'case_id_in', 'case_ids': ['SINGLE', 'U'], 'negate': False}])
            graph_proof(unavailable['identity'], [], ['SINGLE', 'U'])
            empty = pick(population['identity'], [{'kind': 'contains_activity', 'activity': 'Absent', 'negate': False}])
            graph_proof(empty['identity'], [], [])
            controls = [
                (measure('raw_record_count_between', 2, 2), ['RARE', 'SELF', 'SIDE', 'U'], []),
                (measure('raw_record_count_between', 2, 2, True), ['BRIDGE', 'BUSY', 'SINGLE', 'SK'], []),
                (measure('raw_record_count_between', 0, 0), [], []),
                (measure('raw_record_count_between', 3, None), ['BRIDGE', 'BUSY', 'SK'], []),
                (measure('observed_span_between', 0, 0), ['SELF', 'SINGLE'], ['U']),
                (measure('observed_span_between', 0, 0, True), ['BRIDGE', 'BUSY', 'RARE', 'SIDE', 'SK'], ['U']),
                (measure('observed_span_between', 3, 4.000000000277778), ['BRIDGE', 'SIDE'], ['U']),
                (measure('observed_span_between', 4.000000000277778, None), ['BUSY', 'RARE', 'SK'], ['U']),
                (measure('max_raw_gap_between', 0, 0), ['SELF'], ['SINGLE', 'U']),
                (measure('max_raw_gap_between', 0, 0, True), ['BRIDGE', 'BUSY', 'RARE', 'SIDE', 'SK'], ['SINGLE', 'U']),
                (measure('max_raw_gap_between', 3, 3), ['SIDE'], ['SINGLE', 'U']),
                (measure('max_raw_gap_between', 3.000000000277778, None), ['BUSY', 'RARE', 'SK'], ['SINGLE', 'U']),
                (passage('A', 'B', 1, 1), ['SK'], ['U']),
                (passage('A', 'B', 1, 1, 'every'), [], ['U']),
                (passage('A', 'B', 1, 98, 'every'), ['SK'], ['U']),
                (passage('A', 'B', 1, 1, negate=True), ['BRIDGE', 'BUSY', 'RARE', 'SELF', 'SIDE', 'SINGLE'], ['U']),
                (passage('H', 'I', 4, 4), [], ['U']),
                (passage('H', 'I', 4, 4.000000000277778), ['BRIDGE'], ['U']),
                (passage('H', 'I', 4.000000000277778, None), [], ['U']),
                (passage('J', 'J', 0, 0), ['SELF'], ['U']),
                (passage('Absent', 'Missing', 0, None, 'every'), [], ['U']),
                (passage('Absent', 'Missing', 0, None, 'every', True), parent[:-1], ['U']),
            ]
            for predicate, kept, unknown in controls:
                result = pick(population['identity'], [predicate])
                partition(result, kept, unknown)
                partition(result['step_results'][0], kept, unknown)
                partition(result['predicate_results'][0], kept, unknown)
            comparison_ranges = [controls[index] for index in (0, 4, 8, 12)]
            comparison_ranges.append((None, ['SK'], ['U']))
            for predicate, kept, unknown in comparison_ranges:
                cohort_predicates = [predicate] if predicate is not None else [
                    trail[0], measure('observed_span_between', 0, 200), measure('max_raw_gap_between', 0, 100), trail[1]]
                comparison_definition = {'mode': 'two_named_groups',
                    'target': {'name': 'Literal ranges', 'definition': {'kind': 'predicates', 'predicates': cohort_predicates}},
                    'reference': {'name': 'Recorded side path', 'definition': {'kind': 'explicit_case_ids', 'case_ids': ['SIDE']}}}
                comparison = ask('/api/investigations/compare-groups', envelope('compare_groups_request', workspace_id=workspace['workspace_id'],
                    identity=population['identity'], parent_case_ids=parent, context_column_index=4,
                    context_policy=CONTEXT, definition=comparison_definition), 'group_comparison_answer')
                assert comparison['identity'] == population['identity'] and comparison['parent_identity'] == full['identity']
                assert comparison['parent'] == support(parent) and comparison['definition'] == comparison_definition
                assert comparison['target']['included'] == support(kept) and comparison['target']['unevaluable'] == support(unknown)
                assert comparison['target']['excluded'] == support([case for case in parent if case not in kept and case not in unknown])
                assert comparison['reference']['included'] == support(['SIDE'])
            chosen = pick(population['identity'], trail, active=2)
            partition(chosen, ['SK'], ['U'])
            expected_prefixes = [(parent[:5] + ['SK', 'U'], []), (['SK'], ['U']), (['SK'], []), ([], [])]
            for step, (kept, unknown) in zip(chosen['step_results'], expected_prefixes):
                partition(step, kept, unknown)
            for result, (kept, unknown) in zip(chosen['predicate_results'], [
                    (parent[:5] + ['SK', 'U'], []), (['SK'], ['U']), (['BRIDGE', 'BUSY', 'SK'], []),
                    (['BRIDGE', 'BUSY', 'RARE', 'SELF', 'SIDE', 'SINGLE'], ['U'])]):
                partition(result, kept, unknown)
            prefix = pick(population['identity'], trail[:2])
            assert chosen['identity'] == prefix['identity']
            for key in ('kept', 'removed', 'unevaluable'):
                assert chosen[key] == prefix[key]
            beginning = pick(population['identity'], trail, active=0)
            partition(beginning, parent)
            assert beginning['identity'] == full['identity'] and beginning['step_results'] == chosen['step_results']
            first_step = pick(population['identity'], trail, active=1)
            first_prefix = pick(population['identity'], trail[:1])
            assert first_step['identity'] == first_prefix['identity']
            partition(first_step, parent[:5] + ['SK', 'U'])
            completed = pick(population['identity'], trail)
            partition(completed, [])
            permuted = pick(population['identity'], [trail[1], trail[0], *trail[2:]])
            assert completed['identity'] == permuted['identity']
            partition(permuted['step_results'][0], ['SK'], ['U'])
            duplicate = pick(population['identity'], [trail[0], trail[0], trail[1]])
            assert duplicate['identity'] == prefix['identity']
            assert duplicate['step_results'][0]['kept'] == duplicate['step_results'][1]['kept']
            bad = [
                {**trail[0], 'minimum_records': True}, {**trail[0], 'maximum_records': 2.5},
                {**trail[0], 'minimum_records': -1}, {**trail[0], 'minimum_records': 9007199254740992},
                {**trail[0], 'minimum_records': 7, 'maximum_records': 6},
                {**trail[3], 'minimum_hours': '0'}, {**trail[3], 'minimum_hours': None},
                {**trail[3], 'minimum_hours': -1}, {**trail[3], 'minimum_hours': 101},
                {**trail[3], 'minimum_hours': 10 ** 309},
                {**trail[1], 'quantifier': 'some'}, {k: v for k, v in trail[1].items() if k != 'quantifier'},
                {**trail[1], 'source_activity': ''}, {**trail[1], 'extra': 0}]
            for predicate in bad:
                denied(population['identity'], [predicate])
            for active in (None, True, .5, -1, len(trail) + 1):
                denied(population['identity'], trail, 'invalid_request', 400, active_step_count=active)
            denied(population['identity'], [*trail, {'kind': 'case_id_in', 'case_ids': ['OUT'], 'negate': False}],
                   'case_outside_parent', active_step_count=0)
            denied(population['identity'], [*trail, {**trail[1], 'maximum_hours': -1}], active_step_count=0)
            stale = {**population['identity'], 'population_id': 'population.v1:sha256:' + '0' * 64}
            denied(stale, [trail[0]], 'identity_mismatch', 409)
        else:
            before = prior[wall]
            restored = ask('/api/investigations/reopen', envelope('reopen_investigation_request', workspace_id=workspace['workspace_id'],
                saved_revision_id=before['saved']['saved_revision_id']), 'reopen_investigation_answer', preview=False)
            assert restored['revision'] == before['saved']
            assert restored['restored_comparison_id'] == before['comparison']['comparison_id']
            comparison = before['comparison']
            chosen = restored['restored_selection']
            for field in ('identity', 'parent_identity', 'parent', 'kept', 'removed', 'unevaluable', 'predicate_results', 'step_results', 'active_step_count'):
                assert chosen[field] == before['prefix'][field]
            partition(chosen, ['SK'], ['U'])
            full = {'identity': chosen['parent_identity']}
        traces = {}
        for case in parent:
            trace = ask('/api/investigations/case-evidence', envelope('imported_case_evidence_request', workspace_id=workspace['workspace_id'],
                identity=full['identity'], case_id=case), 'imported_case_evidence_answer')
            assert trace['identity'] == full['identity'] and trace['case_id'] == case
            assert [row['source_position'] for row in trace['records']] == positions[case]
            assert [row['original_cells'] for row in trace['records']] == [original[index] for index in positions[case]]
            assert isinstance(trace.get('incident_time'), dict)
            traces[case] = trace
        current_graph = graph_proof(chosen['identity'], [paths[i] for i in (0, 5)], ['SK'])
        bridge = next(edge for edge in graph_proof(full['identity'], paths, parent)['edges']
                      if edge['payload']['source_activity'] == 'H' and edge['payload']['target_activity'] == 'I')
        assert bridge['payload']['bridged_passage_count'] == 1 and bridge['payload']['gap_case_ids'] == ['BRIDGE']
        assert bridge['payload']['omitted_row_ids'] == [traces['BRIDGE']['records'][1]['row_id']]
        listed = ask('/api/investigations/case-list', envelope('case_list_request', workspace_id=workspace['workspace_id'], identity=chosen['identity'],
            query={'search_text': None, 'sort': {'field': 'case_id', 'direction': 'ascending'}, 'offset': 0, 'limit': 20}), 'case_list_answer')
        assert [row['case_id'] for row in listed['rows']] == ['SK']
        assert listed['rows'][0]['time_summary'] == traces['SK']['incident_time']['summary']
        trend = ask('/api/investigations/start-trend', envelope('start_trend_request', workspace_id=workspace['workspace_id'], identity=chosen['identity'],
            definition={'policy_id': 'incident.start_trend.first_raw_declared_order_half_open.v1', 'binning': {'kind': 'explicit_edges',
                'timestamp_kind': kind, 'edges': [stamp(value) for value in ('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', '2026-10-06T00:00:00Z')]}}), 'start_trend_answer')
        assert trend['parent_support'] == support(parent)
        assert [item['kept_support']['case_ids'] for item in trend['bins']] == [['SK'], []]
        assert trend['unevaluable']['parent_support'] == support(['U'])
        groups = ask('/api/investigations/rule-groups', envelope('rule_groups_request', workspace_id=workspace['workspace_id'], identity=chosen['identity'],
            query={'rule': {'kind': 'activity_presence', 'activity': 'A'}, 'distribution_edges_hours': [0, 1, 200], 'offset': 0, 'limit': 20}), 'rule_groups_answer')
        assert groups['parent_identity'] == full['identity'] and groups['catalogue_scope'] == 'frozen_parent'
        assert {group['key']['present']: group['population']['cases']['case_ids'] for group in groups['groups']} == {False: [], True: ['SK']}
        views = {'graph': current_graph, 'case_list': listed, 'start_trend': trend, 'rule_groups': groups}
        views['comparison_cohorts'] = {}
        for role, case, expected_paths in [('target', 'SK', [paths[i] for i in (0, 5)]), ('reference', 'SIDE', [paths[4]])]:
            identity = comparison[role]['identity']
            trace = ask('/api/investigations/case-evidence', envelope('imported_case_evidence_request',
                workspace_id=workspace['workspace_id'], identity=identity, case_id=case), 'imported_case_evidence_answer')
            assert trace['identity'] == identity and trace['records'] == traces[case]['records']
            assert trace['incident_time'] == traces[case]['incident_time']
            views['comparison_cohorts'][role] = {'identity': identity, 'trace': trace,
                                                'graph': graph_proof(identity, expected_paths, [case])}
        # The six hours values round equal; the supplied exact ranking must not.
        huge_paths = [('P' + str(i), 'Q' + str(i), 315506361600000001 + i, 1, 1, 87640656) for i in range(5, -1, -1)]
        tied_paths = [('Z', 'Z', 36000000000, 2, 2, 5), ('A', 'B', 36000000000, 1, 1, 10)]
        if prior is None:
            huge_raw = ('case,activity,at,seq,Desk\n' + ''.join(
                f'H{i},P{i},0001-01-01T00:00:00Z,1,East\nH{i},Q{i},9999-01-01T00:00:00.00000{i + 1}Z,2,West\n'
                for i in range(6))).encode()
            tied_raw = b'''case,activity,at,seq,Desk
T1,A,2026-10-01T00:00:00Z,1,East
T1,B,2026-10-01T10:00:00Z,2,West
T2,Z,2026-10-01T00:00:00Z,1,East
T2,Z,2026-10-01T05:00:00Z,2,West
T3,Z,2026-10-01T00:00:00Z,1,East
T3,Z,2026-10-01T05:00:00Z,2,West
'''
            clock_raw = b'''case,activity,at,seq,Desk
CLOCK,ClockA,2026-10-01T00:00:00+02:00,1,East
CLOCK,ClockB,2026-10-01T00:30:00+01:00,2,West
'''
            if wall:
                huge_raw = re.sub(rb'(T\d\d:\d\d:\d\d(?:\.\d+)?)Z,', rb'\1,', huge_raw)
                tied_raw = re.sub(rb'(T\d\d:\d\d:\d\d(?:\.\d+)?)Z,', rb'\1,', tied_raw)
                clock_raw = clock_raw.replace(b'+02:00,', b',').replace(b'+01:00,', b',')
            extra = {name: prepare_fixture(blob, name, cutoff)['identity'] for name, blob, cutoff in (
                ('huge', huge_raw, '9999-12-31T23:59:59.999999Z'), ('tied', tied_raw, '2026-12-01T00:00:00Z'),
                ('clock', clock_raw, '2026-12-01T00:00:00Z'))}
        else:
            extra = before['extra_identities']
        views['huge_graph'] = graph_proof(extra['huge'], huge_paths, ['H0', 'H1', 'H2', 'H3', 'H4', 'H5'])
        views['tied_graph'] = graph_proof(extra['tied'], tied_paths, ['T1', 'T2', 'T3'])
        views['clock_graph'] = graph_proof(extra['clock'], [('ClockA', 'ClockB', 1800000000 if wall else 5400000000,
                                                          1, 1, .5 if wall else 1.5)], ['CLOCK'])
        if prior is None:
            saved = ask('/api/investigations/save', envelope('save_investigation_request', workspace_id=workspace['workspace_id'], investigation_id=None,
                expected_revision_id=None, name=kind + ' passage ranges and active prefix', base_identity=population['identity'],
                selection_identity=chosen['identity'], selection_recipe={'parent_case_ids': parent, 'predicates': trail[:2]}, context_policy=CONTEXT,
                comparison={'kind': 'group', 'comparison_id': comparison['comparison_id'], 'parent_case_ids': parent,
                    'context_column_index': 4, 'context_policy': CONTEXT, 'definition': comparison_definition},
                notes='Invented complete records; active prefix only.', bookmarks=[]), 'save_investigation_answer', preview=False)['revision']
            assert saved['content']['selection_recipe'] == {'parent_case_ids': parent, 'predicates': trail[:2]}
            proofs.append({'saved': saved, 'prefix': prefix, 'traces': traces, 'views': views, 'extra_identities': extra,
                           'comparison': comparison})
        else:
            assert traces == before['traces'] and views == before['views']
    return proofs, counts


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
        work = Path(temporary); workspace_path = work / 'Überprüfung Workspace'
        assert not workspace_path.exists()
        with socket.socket() as reserved:
            reserved.bind(('127.0.0.1', 0)); port = reserved.getsockname()[1]
        with host(work, 1, port) as (base, first):
            examples = actual_examples(base, spec, wheel)
            assert not workspace_path.exists(), 'Health and sample reads must not create a workspace.'
            workspace = initialize_workspace(base, workspace_path)
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
            scored, score_proof = scoring(base, workspace, bundle, spec['scoring_definition']) if 'scoring' in features else (None, None)
            scored_saved = save_scored_question(base, workspace, score_proof) if scored and 'saving' in features else None
            recorded_proofs, recorded_counts = recorded_route_checks(base, workspace)
            service_proofs, service_counts = next_service_checks(base, workspace)
        assert first.poll() is not None
        with host(work, 2, port) as (base, second):
            assert first.pid != second.pid
            reopened_workspace = initialize_workspace(base, workspace_path)
            assert reopened_workspace['workspace_id'] == workspace['workspace_id']
            _, restored_recorded_counts = recorded_route_checks(base, reopened_workspace, recorded_proofs)
            _, restored_service_counts = next_service_checks(base, reopened_workspace, service_proofs)
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
            if scored:
                if scored_saved:
                    restored_score_question = answer(base, '/api/investigations/reopen', envelope('reopen_investigation_request', workspace_id=workspace['workspace_id'], saved_revision_id=scored_saved['revision']['saved_revision_id']), 'reopen_investigation_answer')
                    assert restored_score_question['revision'] == scored_saved['revision']
                    assert restored_score_question['revision']['content']['score_run_ref'] == scored_saved['revision']['content']['score_run_ref']
                    assert restored_score_question['restored_selection']['identity'] == scored_saved['selection']['identity']
                    assert restored_score_question['restored_selection']['kept']['case_count'] == 8
                # The second CLI has never validated or scored this reading.
                # Read its original nine-case result before any fresh population query.
                read = answer(base, '/api/expectations/read-run', envelope('read_score_run_request', workspace_id=workspace['workspace_id'], run_id=scored['run_id']), 'score_run_answer')
                assert read['run'] == score_proof['run']
                after_witness = answer(base, '/api/expectations/case-witness', envelope('score_case_witness_request', workspace_id=workspace['workspace_id'], run_id=scored['run_id'], case_id='REOPEN'), 'score_case_witness_answer')
                assert after_witness == score_proof['witness']
                outside_selection_witness = answer(base, '/api/expectations/case-witness', envelope('score_case_witness_request', workspace_id=workspace['workspace_id'], run_id=scored['run_id'], case_id='NOOPEN'), 'score_case_witness_answer')
                assert outside_selection_witness['case']['case_id'] == 'NOOPEN' and outside_selection_witness['case']['value'] is None
                scored['original_run_read_after_restart'] = True
                scored['saved_selected_case_count'] = 8 if scored_saved else None
                scored['original_scored_case_count'] = 9
                scored['witness_outside_saved_selection_read'] = True
        assert second.poll() is not None
    receipt = {'all_passed': True, 'features': features, 'scope': 'Installed noneditable wheel on this runner; not Windows 11 human download/browser qualification',
               'isolated_python': True, 'checkout_paths_removed': True, 'real_owned_processes': 2, 'both_processes_stopped': True,
               'workspace_created_by_initialization': True, 'default_workspace_reused_after_restart': True,
               'examples': examples, 'imported_source_sha256': hashlib.sha256(raw).hexdigest(), 'complete_selected_rows': 4,
               'preserved_missing_activity': True, 'preparation_equal_after_restart': True,
               'cutoff_proposal_checked': True, 'cutoff_proposal_persisted_state_unchanged': True, 'b4_proposed_cutoff_utc': '2026-10-09T11:00:00Z',
               'opening_context_checked': True, 'variants_checked': True, 'population_views_equal_after_restart': True,
               'saved_revision_reopened': bool(saved), 'saved_comparison_cohorts_restored': 2 if saved else 0,
               'period_comparison_checked': periods is not None, 'b4_cutoff_utc': B4_CUTOFF,
               'period_cohort_case_ids': None if periods is None else {r: periods[r]['included']['case_ids'] for r in ('target', 'reference')},
               'scoring': scored,
               'recorded_routes': {'required_incident_time': True, 'clocks': ['utc_instant', 'wall_clock'],
                   'before_restart_requests': recorded_counts, 'after_restart_requests': restored_recorded_counts,
                   'all_six_predicates': True, 'fixture_cases': 5, 'fixture_records': 10,
                   'fixed_parent_cases': 4, 'fixed_parent_records': 8, 'complete_raw_preserved': True,
                   'preview_no_durable_writes': True, 'two_saved_recipes_reopened_before_fresh_queries': True},
               'next_service_routes': {'issues': [88, 89, 90, 93], 'clocks': ['utc_instant', 'wall_clock'],
                   'before_restart_requests': service_counts, 'after_restart_requests': restored_service_counts,
                   'fixture_cases': 9, 'fixture_records': 26, 'fixed_parent_cases': 8, 'fixed_parent_records': 24,
                   'exact_total_microseconds': '903600000001', 'top_five_total_microseconds': '889200000001',
                   'all_passage_repeats_and_missing_label_bridge': True, 'zero_and_unavailable_distinct': True,
                   'six_rounded_equal_huge_paths_ranked_by_exact_microseconds': True, 'case_support_tie_order_checked': True,
                   'offset_utc_elapsed_differs_from_recorded_wall': True,
                   'inclusive_ranges_with_unbounded_upper': True, 'any_and_every_passage_quantifiers': True,
                   'exact_microsecond_boundary_discriminators': True, 'strict_typed_refusals': True,
                   'ordered_prefix_counts_and_independent_partitions': True, 'inactive_suffix_still_validated': True,
                   'all_four_ranges_in_actual_comparison': True, 'saved_range_comparison_cohorts_restored': True,
                   'active_prefix_identity_and_registry': True, 'complete_raw_preserved': True, 'preview_no_durable_writes': True,
                   'two_active_prefix_recipes_reopened_before_fresh_selections': True},
               'owned_process_ids': [first.pid, second.pid]}
    args.receipt.write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'all_passed': True, 'features': features, 'real_owned_processes': 2}))


if __name__ == '__main__':
    main()
