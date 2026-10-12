"""Small independent test oracle for synthetic inputs; never used by the application."""
from collections import Counter, defaultdict
from datetime import datetime
from fractions import Fraction
from pathlib import Path
import csv
import statistics


def raw_rows(path: Path) -> list[dict]:
    with path.open(newline='', encoding='utf-8') as stream:
        rows = list(csv.DictReader(stream))
    for position, row in enumerate(rows):
        row['_source_position'] = position
    return rows


def case_rows(rows: list[dict]) -> dict[str, list[dict]]:
    cases: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        cases[row['incident_id']].append(row)
    for history in cases.values():
        history.sort(key=lambda r: (datetime.fromisoformat(r['timestamp_utc']), int(r['source_sequence']), r['_source_position']))
    return dict(cases)


def parent_cases(cases: dict[str, list[dict]]) -> dict[str, list[dict]]:
    return {case: history for case, history in cases.items()
            if all(row['service'] == 'S' for row in history)
            and any(row['activity'] == 'Opened' for row in history)}


def partition(cases: dict[str, list[dict]]) -> tuple[list[str], list[str]]:
    positive, negative = [], []
    for case, history in cases.items():
        (positive if any(row['activity'] == 'Resolved' for row in history) else negative).append(case)
    return sorted(positive), sorted(negative)


def mapped_sequence(history: list[dict]) -> list[dict]:
    return [row for row in history if row['activity']]


def graph_and_variants(cases: dict[str, list[dict]]) -> dict:
    variants: dict[str, list[str]] = defaultdict(list)
    edges: dict[str, dict] = {}
    starts, ends = Counter(), Counter()
    for case, history in cases.items():
        mapped = mapped_sequence(history)
        if not mapped:
            continue
        variants[' > '.join(row['activity'] for row in mapped)].append(case)
        starts[mapped[0]['activity']] += 1
        ends[mapped[-1]['activity']] += 1
        for left, right in zip(mapped, mapped[1:]):
            key = left['activity'] + ' > ' + right['activity']
            edge = edges.setdefault(key, {'case_ids': set(), 'gap_hours': []})
            edge['case_ids'].add(case)
            seconds = int((datetime.fromisoformat(right['timestamp_utc']) - datetime.fromisoformat(left['timestamp_utc'])).total_seconds())
            edge['gap_hours'].append(Fraction(seconds, 3600))
    result_edges = {}
    for key, edge in edges.items():
        gaps = sorted(edge['gap_hours'])
        result_edges[key] = {
            'case_ids': sorted(edge['case_ids']),
            'cases': len(edge['case_ids']), 'passages': len(gaps),
            'gap_hours': [int(g) if g.denominator == 1 else str(g) for g in gaps],
            'mean_hours': str(sum(gaps) / len(gaps)), 'median_hours': str(statistics.median(gaps)),
        }
    return {'variants': {key: sorted(value) for key, value in variants.items()},
            'edges': result_edges, 'start': dict(starts), 'end': dict(ends)}


def opening_category(history: list[dict]) -> str:
    opened = next(row for row in history if row['activity'] == 'Opened')
    return ('value:' + opened['assignment_group']) if opened['assignment_group'] else 'missing:assignment_group'


def opening_profile(cases: dict[str, list[dict]], positive: list[str], negative: list[str]) -> dict:
    categories = sorted({opening_category(history) for history in cases.values()})
    baseline = Fraction(len(negative), len(cases))
    result = {}
    for category in categories:
        a = [case for case in positive if opening_category(cases[case]) == category]
        b = [case for case in negative if opening_category(cases[case]) == category]
        sa, sb = Fraction(len(a), len(positive)), Fraction(len(b), len(negative))
        rate = Fraction(len(b), len(a) + len(b))
        result[category] = {
            'A_ids': a, 'B_ids': b,
            'share_A': str(sa), 'share_B': str(sb),
            'delta_B_A_pp': str((sb - sa) * 100),
            'composition_B_A': str(sb / sa) if sa else 'no_reference_support',
            'outcome_no_resolution_rate': str(rate), 'outcome_lift': str(rate / baseline),
        }
    return result


def resolution_partition(cases: dict[str, list[dict]], limit_hours: int) -> dict:
    over, within, unknown = [], [], []
    for case, history in cases.items():
        opened = next((r for r in history if r['activity'] == 'Opened'), None)
        resolved = next((r for r in history if r['activity'] == 'Resolved'), None)
        if not opened or not resolved:
            unknown.append(case)
            continue
        hours = Fraction(int((datetime.fromisoformat(resolved['timestamp_utc']) - datetime.fromisoformat(opened['timestamp_utc'])).total_seconds()), 3600)
        (over if hours > limit_hours else within).append(case)
    return {'true_ids': sorted(over), 'false_ids': sorted(within), 'unknown_ids': sorted(unknown)}
