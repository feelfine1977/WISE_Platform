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
- The invented sources repeat values the way the full sources do. A real-source run must confirm the projection within 20 percent; a larger gap changes the fixture's shape, not the threshold. The full-source receipt below confirms it: a journey peak of 6.11 GB against 6.52 projected, 4.96 GB retained after both populations against 5.22, and a cold-reopen peak of 5.15 GB against 5.11.
- Peaks are sampled every 50 ms from the process table, so a shorter spike can be missed.
- Service memory per prepared record is 1.68 times the tracemalloc measurement of the same record: 1,577 against 938 bytes. Allocator overhead and memory Python does not return account for the difference.
- These figures predate streamed upload and storage. Uploading then kept about 590 bytes per record resident, about 1 GB for both full sources; the full-source results below show the journey after it.
- The fixture overstates Method scoring: it projects 13.8 GB, while scoring the full sources measured 8.0 GB. Scoring is therefore budgeted at its measured full-source cost, below.

## Full-source qualification

The owner qualifies the same journey on the complete local sources with one command, which writes one receipt:

```text
python tools/qualify_full_sources.py --config ~/wise-full-sources.json --output receipt.json \
    --node NODE --playwright PLAYWRIGHT_INDEX_MJS --chrome CHROME
```

It needs the browser build (`npm run build`). `--no-browser` runs the service journey only, and the receipt then says the browser did not run.

### Configuration

The configuration is a local JSON file kept outside the repository. It names each source and how it is read:

| Field | Meaning |
| --- | --- |
| `native`, `prepared` | Each has `path`, `sha256`, `dialect`, `mapping`, `policies` and optional inspection `hints` |
| `prepared_roles` | The profile roles of the prepared source |
| `measure_roles` | The measure and scoring roles of the prepared source |
| `lineage_origin_column` | The native column the category lineage compares with |
| `expected` | `record_count` per source and `case_count` |

### How a run is guarded

1. Both sources are hashed and must equal the configured digests.
2. Admission requires the memory limit plus the reserve, 14 GiB and 8 GiB by default, to be available without memory pressure. On macOS that means the kernel's memory-pressure level is normal, and its free percentage of physical memory covers the requirement; file cache the system reclaims on demand counts as available. Linux uses `MemAvailable` and refuses while reclaim stalls. Windows uses available physical memory.
3. The service runs on an ephemeral loopback port. It is killed if its process tree exceeds the memory limit or the run passes its deadline, 30 minutes by default.
4. After the cold reopen, the built browser opens the reopened investigation's population, profile and evidence views.
5. Every owned process must be gone and every port closed.

### Receipt

The receipt, format `wise.full_source_receipt.v1`, holds no source path and no record contents.

| Field | Content |
| --- | --- |
| `status`, `reason` | `passed`, `failed` or `refused`, and why |
| `provenance` | Commit, whether it had uncommitted changes, Python, platform and a digest of the browser build |
| `source_sha256` | Both sources' digests |
| `admission` | The reading, the required bytes and the decision |
| `memory_limit_bytes`, `reserve_bytes`, `transport` | The guard and how the service was reached |
| `journey` | Every stage's wall time, peak and retained service memory and reply size; the checks that passed; idle and peak memory; any breach |
| `browser` | Each view's time and the browser's peak memory |
| `cleanup` | Owned process ids, any that survived, and whether every port closed |
| `counts`, `elapsed_seconds` | Records per source, cases and run time |

## Full-source results

The same machine, with the complete native and prepared BPIC19 sources, 1,595,923 records each and 251,734 cases. Each run passed every journey check and the browser views, with every owned process gone afterwards.

| Service memory | Before streamed sources and the budget | After |
| --- | --- | --- |
| Retained after both populations | 5.05 GB | 3.18 GB |
| Journey peak, without scoring | 6.24 GB | 4.43 GB |
| Method scoring peak | 8.00 GB | 6.17 GB |
| Cold reopen peak | 5.15 GB | 3.97 GB |

A run takes about ten minutes. For the native and prepared sources, inspection takes 19 s and 44 s, the cutoff proposal 28 s and 35 s, and the confirmation that reuses its parse 6 s and 8 s. The lineage profile takes 26 s, default measures 31 s, Save 28 s, Method scoring 184 s and a cold reopen 88 s. The browser takes 71 s and peaks at 1.6 GB to show the 251,734-case population.

## Memory budget

The service admits memory-heavy work against one byte budget, 10 GiB by default and set with `WISE_MEMORY_BUDGET_BYTES`. It counts what it keeps — preparations, a parse held for its confirmation, selections and measure and operator summaries — and the estimated peak of the work it admits:

| Work | Estimated peak | Measured on the full sources |
| --- | --- | --- |
| Reading a source | 3.0 bytes per stored byte | 2.2 for the prepared and 2.7 for the native source |
| A population operation | 700 bytes per record | The process graph, the costliest |
| Method scoring | 1,800 bytes per scored record | 2.8 GB for 1,595,923 records |

Kept entries are estimated from samples of their records and multiplied by 1.7, the measured ratio of service memory to estimated bytes. To admit work, the service evicts kept entries no running request uses, least recently used first; an evicted preparation is prepared again from its stored source when it is next used. Work that still cannot fit is refused before it starts with `memory_unavailable`, which states the estimate and the budget, and the service keeps serving.

