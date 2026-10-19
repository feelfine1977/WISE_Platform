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
    # B4's ties lie after T-01's first record (09:00), so no first record is tied.
    assert profile['population'] == {'case_count': 1, 'evaluable_case_count': 1,
        'unevaluable_case_count': 0, 'unevaluable_case_ids': [], 'tied_first_record_case_count': 0}
    assert profile['parent'] == {'case_count': 2, 'evaluable_case_count': 2,
        'unevaluable_case_count': 0, 'unevaluable_case_ids': [], 'tied_first_record_case_count': 0}
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
        assert first.poll() is not None
        with host(work, 2, port) as (base, second):
            assert first.pid != second.pid
            reopened_workspace = initialize_workspace(base, workspace_path)
            assert reopened_workspace['workspace_id'] == workspace['workspace_id']
            _, restored_recorded_counts = recorded_route_checks(base, reopened_workspace, recorded_proofs)
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
               'owned_process_ids': [first.pid, second.pid]}
    args.receipt.write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'all_passed': True, 'features': features, 'real_owned_processes': 2}))


if __name__ == '__main__':
    main()
