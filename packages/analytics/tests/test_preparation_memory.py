"""Retained allocation budget at the public preparation seam, with complete evidence."""
import gc
import hashlib
import json
import os
import shutil
import subprocess
import tracemalloc

import pytest

from memory_literal import arguments, cells, source
from wise_platform_analytics.preparation import PreparationResult, prepare
from wise_platform_analytics.prepared_operations import open_prepared_case


def measured(raw, context):
    gc.collect()
    tracemalloc.start()
    baseline = tracemalloc.get_traced_memory()[0]
    result = prepare(raw, *arguments(context), True)
    assert isinstance(result, PreparationResult) and result.state == "ready" and result.preparation is not None
    gc.collect()
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    ps = shutil.which("ps") if os.name == "posix" else None
    try:
        rss = int(subprocess.check_output([ps, "-o", "rss=", "-p", str(os.getpid())], text=True, timeout=2)) * 1024 if ps else None
    except (OSError, subprocess.SubprocessError, ValueError):
        rss = None
    return result.preparation, current - baseline, peak, rss


@pytest.mark.parametrize("rows", [2000, 4000])
def test_public_preparation_retains_complete_context_with_bounded_wrapper_cost(rows):
    raw = source(rows)
    # Warm parser and datetime caches before starting either measurement.
    prepare(source(2), *arguments(), True)
    plain, without_context, _, _ = measured(raw, False)
    del plain
    prepared, with_context, peak, rss = measured(raw, True)
    overhead = with_context - without_context
    print(json.dumps({"rows": rows, "context_cells": rows * 26, "without_context": without_context,
                      "with_context": with_context, "context_increment": overhead,
                      "peak_traced": peak, "current_rss": rss, "rss_status": "measured" if rss is not None else "unavailable: ps not supported",
                      "identity": prepared.identity_dict()}, sort_keys=True))
    assert not hasattr(prepared, "source")
    assert prepared.source_id == "source.v1:sha256:" + hashlib.sha256(raw).hexdigest()
    # Compatibility pins captured from the passing evidence checks on the original implementation.
    assert prepared.preparation_id == "preparation.v1:sha256:" + {
        2000: "022468f375f25e6110ed73563fe7793b90939086488688eb67982c718cbe8d6d",
        4000: "79697d9011701aeadb0cd26b812e26f16c43a0b3224441908e6ea7f2f8cf52a0",
    }[rows]
    assert prepared.representation_id == "representation.v1:sha256:" + {
        2000: "864fcea7b7cf1749ed88d1f54b5ecea9af8a58b275c33afa2273bef557ca2e1e",
        4000: "da243882ed1eb616b24495bc2be8da7bb69a7ac15b7a82c2541e091a4af83980",
    }[rows]
    assert prepared.case_dictionary_id == "case-dictionary.v1:sha256:" + {
        2000: "30486f2659c28e7ccb576d79eb9901f9e9d331d6e959837a3557690634718bac",
        4000: "67cdc4b3311d770143793cf5da202cfa83831052a015dc072e79dfdb73586e5c",
    }[rows]
    assert prepared.population_id == "population.v1:sha256:" + {
        2000: "6991d47cc0375ffa48d50cee1d900af5fc5b6c90dddcb7cdf7e1dce8c2db9f80",
        4000: "f4d011845b8acdfdd4e0c5d9f2e35ef53b1823d6d9b368db797ff7e2a719e47d",
    }[rows]
    assert len(prepared.records) == rows and len(prepared.histories) == rows // 2
    for position, record in enumerate(prepared.records):
        assert record.original_cells == tuple(cells(position))
        assert record.local_timestamp == ("2018-01-01T00:00:00" if position % 2 == 0 else "2018-01-02T00:00:00")
        assert record.timestamp_kind == "wall_clock" and record.utc_instant is None
        assert [value.to_dict() for value in record.context] == [
            {"column_index": column, "value": None if column == 3 else "Unknown" if column == 4 else f"value-{column}"}
            for column in range(3, 29)]
    for index in range(rows // 2):
        evidence = open_prepared_case(prepared, prepared.identity_dict(), f"M{index:05d}")
        assert evidence["coverage"] == {"raw_record_count": 2, "mapped_record_count": 2, "omitted_activity_record_count": 0}
        assert [entry["original_cells"] for entry in evidence["records"]] == [cells(index * 2), cells(index * 2 + 1)]
    # CPython qualification budget, including wrapper, reference and tuple overhead.
    # Actual observed headroom is about 6 bytes/cell; no assertion on object internals.
    assert overhead <= rows * 26 * 64, (overhead, rows * 26 * 64)
