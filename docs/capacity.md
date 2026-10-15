# Synthetic capacity measurement

No supported capacity tier is declared. This tool measures a named synthetic workload through real local CLI processes and HTTP; it does not establish browser responsiveness, Windows installer behavior or the capacity of a different log shape. Establish a baseline before introducing caching/indexing or claiming a data-size limit.

## Run from a source checkout

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

## Workload and receipt

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

## Interpreting measurements

Before accepting a capacity tier, agree latency and memory/disk budgets with the analyst, record machine RAM/storage/browser/build, repeat measurements, and exercise varied records-per-case, activities, variants, context cardinality, missingness and skew. Measure rendering, filtering and inspection in the supported Windows browser separately. Keep failed-size evidence and the last passing size; do not extrapolate from one successful synthetic size.

Current full-parent work includes case-time summaries and sorting before page slicing, rule-group catalogue rebuilding, and source hashing even for cached preparations. The one-row page timings deliberately expose that cost. The initial hardening work measures those paths; it does not change their semantics, introduce a cache or certify scalability.

## Initial local observation: 2026-10-15

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
