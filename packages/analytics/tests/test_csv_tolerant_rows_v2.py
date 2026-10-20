"""Real CSV defects retain exact source witnesses under explicit rows policy v2."""
import hashlib
import csv
import json

import pytest

from wise_platform_analytics.csv_inspection import FIELD_CHARACTER_LIMIT, CsvData, inspect_csv, read_csv
from wise_platform_analytics.mapping import ImportRefusal
from wise_platform_analytics.preparation import PreparationResult, prepare
from wise_platform_analytics.prepared_operations import open_prepared_case, open_prepared_population
from test_csv_preparation_core import choices, dialect, roles, ready


def v2_choices():
    p=choices()
    p['rows']['id']='incident.rows.missing_id_outside_invalid_time_retained.v2'
    p['rows']['parameters'].update(blank_records='skip_count_preserve_source_ordinal',ragged_records='outside_population_preserve_raw',maximum_ragged_fraction=0.05,field_character_limit=10485760)
    return p


def twenty_with_ragged(extra=True):
    ragged='A;NeverAssociated;09.10.2026 08:01;Extra;Unquoted\r\n' if extra else 'A;NeverAssociated\r\n'
    text='Case;Event;At;Context\r\nA;First;09.10.2026 08:00;Start\r\n\r\n'+ragged
    text+=''.join(f'A;Step{i};09.10.2026 08:{i:02};Known\r\n' for i in range(1,19))+'\r\n'
    return text.encode(),ragged


@pytest.mark.parametrize('extra',[True,False])
def test_one_ragged_of_twenty_is_confirmed_outside_case_with_blank_ordinal_gaps(extra):
    raw,ragged=twenty_with_ragged(extra)
    inspected=inspect_csv(raw)
    assert inspected['record_count']==20
    assert inspected['blank_record_count']==2 and inspected['ragged_record_count']==1
    assert inspected['sample_rows'][1]['source_position']==2
    before=prepare(raw,dialect(),roles(context=(3,)),v2_choices(),False)
    assert isinstance(before,PreparationResult) and before.state=='needs_confirmation' and before.preparation is None
    assert [i['code'] for i in before.report['issues']]==['ragged_record']
    result=prepare(raw,dialect(),roles(context=(3,)),v2_choices(),True)
    assert isinstance(result,PreparationResult) and result.state=='ready'
    p=result.preparation; assert p is not None
    assert p.source_id=='source.v1:sha256:'+hashlib.sha256(raw).hexdigest() and not hasattr(p,'source') and len(p.records)==20 and len(p.histories['A'])==19
    assert [r.source_position for r in p.records]==[0,*range(2,21)]
    excluded=p.records[1]
    assert excluded.case_id is None and excluded.activity is None and excluded.context==()
    assert excluded.source_sequence is None and excluded.timestamp_status=='invalid' and excluded.time_value is None
    assert excluded.row_id.startswith('row.v1:sha256:')
    assert p.sequence_evaluable('A')
    report=result.to_dict()['report']
    assert (report['raw_record_count'],report['identified_record_count'],report['unassigned_record_count'])==(20,19,1)
    assert (report['usable_timestamp_record_count'],report['unavailable_timestamp_record_count'])==(19,1)
    assert report['excluded_source_records']==[{'source_position':2,'physical_line_start':4,'physical_line_end':4,'cell_count':5 if extra else 2,'reason':'ragged_record','original_cells':ragged.rstrip('\r\n').split(';'),'original_text':ragged}]
    population=open_prepared_population(p)
    assert population['population']=={'case_ids':['A'],'case_count':1,'record_count':19}
    evidence=open_prepared_case(p,p.identity_dict(),'A')
    assert len(evidence['records'])==19
    assert 'NeverAssociated' not in [r['activity'] for r in evidence['records']]
    again=prepare(raw,dialect(),roles(context=(3,)),v2_choices(),True)
    assert again.preparation.identity_dict()==p.identity_dict()
    assert again.to_dict()==result.to_dict()
    replay=json.loads(json.dumps(p.descriptor()))
    restored=prepare(raw,replay['dialect'],replay['mapping'],replay['policies'],True)
    assert restored.preparation.identity_dict()==p.identity_dict()
    assert restored.to_dict()==result.to_dict()


@pytest.mark.parametrize(('nonblank','ragged_count','accepted'),[(19,1,False),(20,1,True),(21,1,True),(20,2,False),(40,2,True)])
def test_exact_five_percent_limit_counts_nonblank_records_only(nonblank,ragged_count,accepted):
    raw=('Case;Event;At;Context\n'+''.join('A;Observed;09.10.2026 08:00;Known\n' for _ in range(nonblank-ragged_count))+''.join('A;Broken\n' for _ in range(ragged_count))+'\n'*20).encode()
    result=prepare(raw,dialect(),roles(context=(3,)),v2_choices(),True)
    if accepted:
        assert isinstance(result,PreparationResult) and result.state=='ready'
        assert result.report['raw_record_count']==nonblank and result.report['blank_record_count']==20
    else:
        assert isinstance(result,ImportRefusal) and result.code=='malformed_source'
        assert '5%' in result.message and 'separator' in result.message and 'quoting' in result.message


def test_all_empty_proper_width_is_not_blank_and_multiline_no_final_lf_has_exact_witness():
    raw=b'Case;Event;At;Context\r\nA;First;09.10.2026 08:00;Known\r\n;;;\r\n\r\n;Last;09.10.2026 09:00;"line one\r\nline two"'
    result=prepare(raw,dialect(),roles(context=(3,)),v2_choices(),True)
    assert result.state=='ready'; p=result.preparation; assert p is not None
    assert len(p.records)==3 and [r.source_position for r in p.records]==[0,1,3]
    report=result.to_dict()['report']
    assert report['blank_record_count']==1 and report['ragged_record_count']==0
    assert report['raw_record_count']==3 and report['identified_record_count']==1 and report['unassigned_record_count']==2
    assert report['usable_timestamp_record_count']==2 and report['unavailable_timestamp_record_count']==1
    assert report['missing_cells']==[{'column_index':0,'record_count':2},{'column_index':1,'record_count':1},{'column_index':2,'record_count':1},{'column_index':3,'record_count':1}]
    empty,multiline=report['excluded_source_records']
    assert empty['reason']=='missing_case_id' and empty['cell_count']==4 and empty['original_cells']==['','','',''] and empty['original_text']==';;;\r\n'
    assert multiline=={'source_position':3,'physical_line_start':5,'physical_line_end':6,'cell_count':4,'reason':'missing_case_id','original_cells':['','Last','09.10.2026 09:00','line one\r\nline two'],'original_text':';Last;09.10.2026 09:00;"line one\r\nline two"'}
    assert report['last_usable_local_timestamp']=='2026-10-09T09:00:00'


def test_unicode_nel_vertical_tab_do_not_corrupt_physical_line_or_original_text():
    text='Case;Event;At;Context\r\n;Observed;09.10.2026 08:00;"alpha\x85beta\x0bgamma\r\nsecond"\r\nA;Next;09.10.2026 09:00;Known'
    result=prepare(text.encode('utf-8'),dialect(),roles(context=(3,)),v2_choices(),True)
    assert result.state=='ready'
    witness=result.to_dict()['report']['excluded_source_records'][0]
    assert witness['physical_line_start']==2 and witness['physical_line_end']==3
    assert witness['original_text']==';Observed;09.10.2026 08:00;"alpha\x85beta\x0bgamma\r\nsecond"\r\n'
    assert witness['original_cells'][3]=='alpha\x85beta\x0bgamma\r\nsecond'
    assert result.preparation.histories['A'][0].source_position==1


def test_missing_cell_support_does_not_pad_short_rows_or_associate_their_times():
    raw=('Case;Event;At;Context\n'+''.join('A;Observed;09.10.2026 08:00;Known\n' for _ in range(19))+';\n').encode()
    result=prepare(raw,dialect(),roles(context=(3,)),v2_choices(),True)
    assert result.state=='ready'
    counts={c['column_index']:c['record_count'] for c in result.report['missing_cells']}
    assert counts=={0:1,1:1,2:0,3:0}
    assert result.report['unavailable_timestamp_record_count']==1
    assert result.report['excluded_source_records'][0]['original_cells']==('','')


@pytest.mark.parametrize('data',[b'Case;Event;At\nA;Observed;09.10.2026 08:00\n\n',b'Case;Event;At\n\nA;Observed;09.10.2026 08:00',b'Case;Event;At\nA;Broken\n',b'Case;Event;At\nA;Observed;09.10.2026 08:00;Extra\n'])
def test_v1_remains_strict_for_blank_or_ragged_records(data):
    result=prepare(data,dialect(),roles(),choices(),True)
    assert isinstance(result,ImportRefusal) and result.code=='malformed_source'
    assert 'Source record' in result.message and 'physical lines' in result.message


def test_v2_blank_only_gap_needs_no_fabricated_event_or_confirmation():
    raw=b'Case;Event;At\n\nA;Observed;09.10.2026 08:00\n\n'
    result=prepare(raw,dialect(),roles(),v2_choices(),False)
    assert result.state=='ready' and result.report['raw_record_count']==1 and result.report['blank_record_count']==2
    assert result.preparation.histories['A'][0].source_position==1


def test_field_limit_is_constant_across_reader_requests_and_overflow_has_location():
    assert csv.field_size_limit()==FIELD_CHARACTER_LIMIT==10485760
    def raw(n): return ('Case;Event;At;Context\nA;Observed;09.10.2026 08:00;'+('x'*n)).encode()
    ordinary=prepare(raw(200000),dialect(),roles(context=(3,)),choices(),False)
    assert ordinary.state=='ready' and len(ordinary.preparation.records[0].original_cells[3])==200000
    limit=read_csv(raw(FIELD_CHARACTER_LIMIT),dialect())
    assert isinstance(limit,CsvData) and len(limit.rows[0][3])==FIELD_CHARACTER_LIMIT
    overflow=read_csv(raw(FIELD_CHARACTER_LIMIT+1),dialect(),tolerant=True)
    assert isinstance(overflow,ImportRefusal) and 'Source record 0' in overflow.message and 'physical lines 2..2' in overflow.message and '10485760' in overflow.message
    assert csv.field_size_limit()==FIELD_CHARACTER_LIMIT
    assert isinstance(read_csv(b'Case;Event;At\nA;Observed;09.10.2026 08:00',dialect()),CsvData)


def test_unclosed_quote_has_record_and_physical_line_location():
    raw=b'Case;Event;At;Context\nA;Observed;09.10.2026 08:00;Known\nA;Broken;09.10.2026 09:00;"unclosed\nnext line'
    result=prepare(raw,dialect(),roles(context=(3,)),v2_choices(),True)
    assert isinstance(result,ImportRefusal) and result.code=='malformed_source'
    assert 'Source record 1' in result.message and 'physical lines 3..4' in result.message
    assert 'unexpected end of data' in result.message


def test_v2_registered_parameters_are_not_free_tolerance_controls():
    p=v2_choices(); p['rows']['parameters']['maximum_ragged_fraction']=0.1
    result=prepare(b'Case;Event;At\nA;Observed;09.10.2026 08:00',dialect(),roles(),p,True)
    assert isinstance(result,ImportRefusal) and result.code=='invalid_parameter'
    assert result.field=='policies.rows.parameters'


def test_v2_choice_changes_preparation_identity_without_changing_valid_case_membership():
    raw=b'Case;Event;At\nA;Observed;09.10.2026 08:00'
    strict=prepare(raw,dialect(),roles(),choices(),False)
    tolerant=prepare(raw,dialect(),roles(),v2_choices(),False)
    assert strict.state==tolerant.state=='ready'
    assert strict.source_id==tolerant.source_id
    assert strict.preparation.preparation_id!=tolerant.preparation.preparation_id
    assert strict.preparation.representation_id!=tolerant.preparation.representation_id
    assert list(strict.preparation.histories)==list(tolerant.preparation.histories)==['A']
    assert strict.to_dict()['report']==tolerant.to_dict()['report']
