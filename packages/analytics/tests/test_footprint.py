"""Footprint estimates of prepared data stay close to the memory it actually retains."""
import gc
import tracemalloc

import pytest

from bpic_shaped_literal import arguments, native_arguments, native_source, source
from wise_platform_analytics.footprint import prepared_footprint, reading_footprint
from wise_platform_analytics.preparation import prepare, read_for_preparation


def retained(operation):
    gc.collect()
    tracemalloc.start()
    baseline = tracemalloc.get_traced_memory()[0]
    result = operation()
    gc.collect()
    current = tracemalloc.get_traced_memory()[0]
    tracemalloc.stop()
    return result, current - baseline


@pytest.mark.parametrize("make,interpretation", [(source, arguments), (native_source, native_arguments)], ids=["prepared", "native"])
def test_estimates_are_within_a_quarter_of_retained_memory(make, interpretation):
    prepare(make(12), *interpretation(), True)
    raw = make(12_000)
    result, held = retained(lambda: prepare(raw, *interpretation(), True))
    assert abs(prepared_footprint(result.preparation) - held) <= 0.25 * held, (prepared_footprint(result.preparation), held)
    reading, held = retained(lambda: read_for_preparation(raw, *interpretation()))
    assert abs(reading_footprint(reading) - held) <= 0.25 * held, (reading_footprint(reading), held)
