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

## Incident journey: the first supported tier (#29)

The incident journey's tier is measured, with exact answers checked beside every timing, by one command:

```text
python tools/qualify_incident_capacity.py --output receipt.json --incidents 50000
```

| | |
| --- | --- |
| Machine | Apple M1 Max, 10 cores, 64 GB, macOS (Darwin 25.6.0 arm64) |
| Runtime | Python 3.13.3 |
| Workload | An invented incident log generated in memory: incidents walking forward through 30 activities, three context columns (desk, priority, category) |
| Tier | **50,000 incidents, 394,433 records**, 26.3 MB of CSV |
| Also measured | a quarter of it: 12,500 incidents, 98,602 records |
| Memory budget | the default 10 GiB (`WISE_MEMORY_BUDGET_BYTES`) |
| Run time | under a minute for both sizes and the checks below |

Every stage is one HTTP request to the service, which runs as its own process. At the tier:

| Stage | Wall time | Peak service memory | Retained after | Reply | At a quarter |
| --- | --- | --- | --- | --- | --- |
| Upload (streamed) | 0.04 s | 92 MiB | 92 MiB | 0 KiB | 0.01 s |
| Inspection | 3.82 s | 125 MiB | 110 MiB | 7 KiB | 0.97 s |
| Confirmation (reading) | 5.17 s | 406 MiB | 406 MiB | 5 KiB | 1.27 s |
| Opening the incidents | 0.30 s | 491 MiB | 416 MiB | 6,624 KiB | 0.07 s |
| Opening context | 0.16 s | 419 MiB | 419 MiB | 5 KiB | 0.04 s |
| Start trend | 0.83 s | 590 MiB | 468 MiB | 3,234 KiB | 0.19 s |
| Process graph | 1.09 s | 702 MiB | 521 MiB | 4,853 KiB | 0.22 s |
| Transition matrix | 2.06 s | 681 MiB | 626 MiB | 5,211 KiB | 0.43 s |
| Variants | 1.17 s | 645 MiB | 643 MiB | 9,617 KiB | 0.24 s |
| A step, exact membership | 0.26 s | 643 MiB | 643 MiB | 1,613 KiB | 0.05 s |
| Complete history | 0.02 s | 643 MiB | 643 MiB | 8 KiB | 0.01 s |
| Save | 0.33 s | 643 MiB | 590 MiB | 539 KiB | 0.07 s |
| Cold reopen after a restart | 5.43 s | 502 MiB | 413 MiB | 2,152 KiB | 1.37 s |

- **Journey peak:** 702 MiB, about 0.74 GB. The screen says "at most 0.8 GB".
- **Workspace on disk:** 25.0 MiB after the import (the source's bytes and its reading), and 25.6 MiB after Save.
- **Measured** by the command above at commit `faf55a4`. A rerun differs by a few percent: the receipt attached to #29 is a later run of the same code.

### Checked alongside

- **Exact answers:** every incident and record; every activity on the graph; the exact number of variants; the step's exact membership, compared with the generator's own list; three complete histories, record by record; and the saved investigation reopened after a restart with the same identity and incidents.
- **An abandoned request:** the client gives up after 20 ms; the same request is then answered. Retained memory went from 413 MiB to 637 MiB, which is the answer kept for reuse, still within the budget.
- **An interrupted publication:** a second reading's confirmation was cut off by killing the service. After a restart, the workspace lists only complete readings (1), and the first one opens as before.
- **Beyond the budget:** with a budget the size of the source, its reading is refused before anything is read, with the memory it needs and how to raise the budget. The workspace is unchanged:

  > Reading this source needs about 79 MB more memory than the service may use now: its budget is 26 MB, and 0 MB is held for open work that cannot be released. Nothing was read or changed. Close other work, or raise the budget with WISE_MEMORY_BUDGET_BYTES if this computer has the memory.

### What the screen says

- The Data area states this tier beside the import, together with the memory the service may use (from `/api/health`), and says that larger files are not measured.
- Work that would not fit the byte budget is refused before it starts. The bound is the byte budget, not a count of cached entries.
- Pending work is shown while it runs (#54).
- Every figure is exact, and the screen says so: no incident or record is sampled. Where the map draws fewer activities or paths than it counts, its detail strip says so.

### Limits

- This is one machine and one invented workload shape. A larger tier, or the Windows release tier, needs its own measured workload and a decision. It is not inferred from this one.
- Peaks are sampled every 50 ms from the process table, so a shorter spike can be missed.

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

## Synthetic capacity benchmark

No supported capacity tier is declared. This tool measures a named synthetic workload through real local CLI processes and HTTP; it does not establish browser responsiveness, Windows installer behavior or the capacity of a different log shape. Establish a baseline before introducing caching/indexing or claiming a data-size limit.

### Run from a source checkout

Use the isolated, locked development environment from [development](development.md), including the exact Method wheel. The benchmark uses only standard-library tooling itself; its owned application processes use that environment's installed dependencies. Node and built browser assets are not required for the measurement. The installed-bundle tool remains a separate artifact check.

Choose an existing output folder outside the source checkout, program files and any real workspace. The tool refuses an existing receipt and creates its synthetic workspaces in an automatically cleaned temporary directory. It accepts no user CSV, server URL or existing workspace path. Do not redirect the benchmark at a running analyst service.

macOS/Linux example, after activating the environment:

```bash
git rev-parse HEAD
git status --short
python tools/benchmark_capacity.py --cases 1000 --records-per-case 10 --repeats 3 --output "$HOME/wise-capacity-1000.json"
python tools/benchmark_capacity.py --cases 10000 --records-per-case 10 --repeats 3 --output "$HOME/wise-capacity-10000.json"
```

Windows PowerShell source-checkout equivalent:

```powershell
git rev-parse HEAD
git status --short
python tools/benchmark_capacity.py --cases 1000 --records-per-case 10 --repeats 3 --output "$env:TEMP\wise-capacity-1000.json"
python tools/benchmark_capacity.py --cases 10000 --records-per-case 10 --repeats 3 --output "$env:TEMP\wise-capacity-10000.json"
```

Record the commit and any local changes alongside the receipts; an application version alone does not identify a candidate build. Use a new output filename for each run. Increase sizes only while there is enough memory, disk and operator time. `--timeout` defaults to 120 seconds per HTTP request and startup; exceeding it fails the command and does not produce a successful receipt. The value is not a whole-run deadline. A failed run cleans up its owned hosts and temporary state; preserve terminal diagnostics separately, never infer a passing tier from a timeout.

### Workload and receipt

The input is deterministic: two or more cases, two to 10,000 hourly records per case, UTC times, `Opened`, repeated `Work` and `Resolved`, alternating East/West opening context, and starts spread across 28 days. This exercises repeated passages but only a small activity/context vocabulary, with no invalid/missing times. It is not a realistic high-cardinality or poor-quality-data workload.

The JSON receipt names its synthetic shape/hash, actual Python/OS/CPU architecture and application/analytics versions, the pinned Method artifact metadata, raw timing samples, median/max latency, workspace disk bytes, and OS child-process peak RSS where available. On Windows `peak_rss_bytes` is explicitly null: record the application's process peak working set separately using approved OS tooling. No zero or estimated value is substituted for missing memory evidence.

| Timing | Scope |
| --- | --- |
| `startup`, `upload`, `inspect`, `prepare`, `open_population` | First CLI readiness and actual CSV-to-population HTTP operations; one sample each |
| `select`, `graph`, `case_list_first`, `case_list_next`, `rule_groups`, `compare` | Repeated complete-case queries and two one-row pages; each has `--repeats` samples including its first call |
| `validate`, `score`, `read_run` | One fresh reviewed timing definition/run, then repeated retrieval of that original run; retrieval is not rescoring |
| `save` | One saved question with its full parent, selected East cases and original whole-parent run reference |
| `backup_copy`, `restore_copy` | Complete directory copies after the first host stops; byte hashes must match before starting the restored host |
| `restart`, `reopen`, `evidence` | A new CLI on the restored folder; identical saved selection, complete records/diagnostics and original score run checked |

HTTP timings include request serialization, local transport, server computation and answer decoding; membership checks occur after the timer. Input generation and backup hash verification are not included in query timings. Repeated queries reuse in-memory preparations and OS caches but still include application integrity checks. Do not label them cold disk measurements. Unix RSS is the child-process high-water value across the two owned hosts, not a time series, per-operation allocation or whole-machine memory use.

The tool fails on refusals, unexpected reply identity, incorrect membership, incomplete histories or changed restored evidence. It independently checks both presence-rule buckets, exact scored IDs, applicability, elapsed hours and Method values against the authored synthetic target. `verified_semantics` summarizes the checked answers; the CLI tests cover literal 2h/0, 5h/0.5 and 9h/1 results. A successful receipt is not just a timer output. `tests/test_capacity_benchmark.py` runs the small CLI/HTTP journeys and safety checks in the regular Python suite; it imposes no performance threshold.

### Interpreting measurements

Before accepting a capacity tier, agree latency and memory/disk budgets with the analyst, record machine RAM/storage/browser/build, repeat measurements, and exercise varied records-per-case, activities, variants, context cardinality, missingness and skew. Measure rendering, filtering and inspection in the supported Windows browser separately. Keep failed-size evidence and the last passing size; do not extrapolate from one successful synthetic size.

Current full-parent work includes case-time summaries and sorting before page slicing, rule-group catalogue rebuilding, and source hashing even for cached preparations. The one-row page timings deliberately expose that cost. The initial hardening work measures those paths; it does not change their semantics, introduce a cache or certify scalability.

### Initial local observation: 2026-10-15

Application base `d9ef6706fe08b730e45de9d4296c9d73b57470ef`, with the benchmark introduced by this hardening change; application/analytics 0.1.0, Python 3.13.3, macOS 26.6.2 arm64, 10 logical CPUs, pinned unreleased Method 0.2.0. Each size was run sequentially with 10 records per case and three repeated query samples, before running the full suite. These are single-run development observations, not release or hardware qualification; machine RAM/storage and browser performance were not measured.

| Observation | 1,000 cases / 10,000 records | 10,000 cases / 100,000 records |
| --- | --- | --- |
| Input bytes | 416,031 | 4,160,031 |
| Preparation, one sample | 0.121 s | 1.310 s |
| Selection, median | 0.006 s | 0.045 s |
| First one-row page, median | 0.024 s | 0.227 s |
| Next one-row page, median | 0.024 s | 0.232 s |
| Rule groups, median | 0.024 s | 0.238 s |
| Comparison, median | 0.012 s | 0.115 s |
| Fresh scoring, one sample | 0.053 s | 0.587 s |
| Stored run read, median | 0.021 s | 0.249 s |
| Reopen restored question, one sample | 0.135 s | 1.361 s |
| Child-process high-water RSS | 135.6 MiB | 332.5 MiB |
| Complete workspace bytes | 654,157 | 6,360,189 |

Both runs independently checked the selected East membership (500/5,000 cases and 5,000/50,000 complete records), present/absent rule buckets, and a 9-hour interval with Method value 1 for every scored parent case. Both restored questions, complete evidence and original runs matched after stopped copies. Comparable first/next page costs are consistent with full-parent work; they do not establish the cause of every latency or bound behavior at larger sizes. Raw receipts remain external runtime evidence rather than product source; rerun the commands above for a new candidate and retain its own receipts.

## Catalogue workloads (#99)

`tools/qualify_preparation_catalogue.py` measures each whole view of a preparation catalogue in its own process. Each view is measured twice:

- **import:** store, inspect, prepare and open;
- **investigation:** the map and variants of the whole population.

Each measurement records records, incidents, columns, versions, elapsed time and peak process-tree memory. These are measurements of named workloads, kept apart from the pilots. They claim no capacity tier; a confirmed limit becomes a follow-up under #29.
