# Measured capacity

Capacity is measured on a named machine for a named workload, never promised in general. Every measurement checks exact membership and answers alongside its timings.

## BPIC19 descriptive journey on a developer machine

This is the first workload measured for the first supported capacity tier. It is a developer machine, not the Windows release tier, which stays a separate gate.

| | |
| --- | --- |
| Machine | Apple M1 Max, 10 cores, 64 GB, macOS 26.6.2 arm64 |
| Runtime | Python 3.13.3 |
| Workload | Invented native22 and prepared29 BPIC19-shaped sources describing one population, about six events per case |
| Sizes measured | 49,998 and 99,996 records per source |
| Projected to | 1,595,923 records per source, the size of both full BPIC19 sources |
| Budget | 14 GiB peak service memory for the whole journey |
| Command | `python tools/qualify_capacity.py --rows 100000` |
| Run time | 77 seconds |

The journey runs through the real service: upload, inspection, cutoff proposal and confirmation of both sources, opening both populations, case evidence, selection, the attribute profile, the category-lineage profile across both sources, default measures, process graph, variants, Save, restart, cold reopen and reopening the population. Method scoring is measured separately.

### Result

| At 1,595,923 records per source | Projected service memory |
| --- | --- |
| Retained after both populations are open | 5.2 GB |
| Journey peak, during the profiles and Save | 6.5 GB, 43% of the budget |
| Cold reopen after restart | 5.1 GB |
| Method scoring, separately | 13.8 GB, 92% of the budget |

At 99,996 records per source the stages measured:

| Stage | Wall time | Peak service memory | Reply |
| --- | --- | --- | --- |
| Native inspection | 1.6 s | 181 MB | 0.02 MB |
| Native cutoff proposal | 1.9 s | 265 MB | under 0.01 MB |
| Prepared inspection | 3.3 s | 341 MB | 0.03 MB |
| Prepared cutoff proposal | 1.9 s | 421 MB | under 0.01 MB |
| Prepared confirmation, reusing the proposal's parse | 0.6 s | 421 MB | 0.01 MB |
| Category-lineage profile | 1.1 s | 474 MB | 1.6 MB |
| Default measures | 2.0 s | 475 MB | 3.5 MB |
| Save | 1.4 s | 511 MB | 2.0 MB |
| Method scoring | 11.8 s | 859 MB | 2.8 MB |
| Cold reopen | 5.1 s | 411 MB | 2.6 MB |

The full profile, with every stage, its fitted bytes per record and the run's checks, is written as JSON by the command.

### Assumptions and limits

- Each stage's peak and retained memory is fitted as a line in records per source and projected beyond the measured sizes.
- The invented sources repeat values the way the full sources do. A real-source run must confirm the projection within 20 percent; a larger gap changes the fixture's shape, not the threshold. That confirmation needs an in-repository real-source qualification and is pending.
- Peaks are sampled every 50 ms from the process table, so a shorter spike can be missed.
- Service memory per prepared record is 1.68 times the tracemalloc measurement of the same record: 1,577 against 938 bytes. Allocator overhead and memory Python does not return account for the difference.
- Uploading keeps about 590 bytes per record resident, about 1 GB for both full sources. Streaming the upload to storage would remove it; the journey fits without it.
- Method scoring has its own admission limit on cases and records, which may refuse the full population before memory is reached. Its projection is close to the budget, so the full paper workflow should be qualified with scoring measured, not assumed.
