# Testing and qualification

Tests qualify a named scope. The candidate now has import, selection, comparison, time/explorer, scoring and persistence suites in addition to M0 foundation checks. None alone establishes a Windows release. Follow the development setup for the current commands and [current status](status.md) for the evidence map and remaining gates.

## Test layers

1. **Contracts:** authoritative schema generates both clients; validate optional fields, typed support, version/refusal states and health status. Generated structure alone does not establish analytical semantics.
2. **Pure analytical fixtures:** literal small synthetic records and expected incident IDs/counts/sequences/times precede implementation. No company input is required.
3. **Adapter parity:** compare every supported execution adapter against those expectations. A SQL optimization cannot introduce a second definition.
4. **Application state/storage:** revision guards, failed jobs, cancellation, full evidence pagination, atomic publication and durable save/reopen.
5. **Browser interactions:** common population across chart/map/matrix/variants/evidence, accessible tables/keyboard, and distinguish highlight from committed refinement.
6. **Windows release:** approved runtime/assets, setup/start/stop/restart, offline local use, backup/recovery, declared capacity and a human investigation.

## Required analytical fixtures

- Exact complete-case selection retains all records, including those outside a case-start selection period.
- Repeated transitions separate incident support from passage occurrences. Matrix outgoing shares use a different denominator from cohort support; zero lag differs from unavailable lag.
- Equal timestamps use an explicitly authoritative sequence. Conflicting timestamp/sequence authority is tested or refused. Null activity projection preserves original rows and does not manufacture terminal records or hide supported mapped relations.
- Opening context is not first nonmissing context. Missing values and literal “Unknown” use separate keys; ever-membership can overlap and must not sum as exclusive shares.
- A frozen parent includes retained filters and eligibility. Target/reference roles are stored independently of predicate orientation. Reversal changes ratio/difference direction; inversion changes membership.
- Event-presence complements are binary. Nullable measures/scores expose measured-over, measured-not-over and unevaluable groups with reasons. Missing endpoints never count as passed.
- Paired profiles test exact counts, shares, percentage-point differences, concentration ratios and separately conditioned outcome rates. Zero baseline, tiny/empty support and fixed-by-parent fields have explicit outputs.
- Strict time thresholds include exact-boundary cases. First resolution, final resolution and reopening cycles are distinct named definitions.

Expected results must not be computed by copying the implementation under test. Browser counts are real supplied answers, not mock counters presented as analytical results.

## Recovery and persistence

Issue overlapping queries; deliver obsolete success, error and pagination replies after the current revision and confirm they cannot replace it. A current failure leaves a coherent previous answer marked with its state. Test cancellation, retry and partial publication.

Save an unscored investigation and one with an optional norm/score. Stop the application and reopen in another process. Verify source/preparation/representation, complete membership, target/reference roles, context reducer, bins, measures, notes and witnesses. Changed/moved/corrupt/incompatible sources or artifacts must produce explicit freshness/refusal behavior. Test database-aware backup/restoration rather than a copy of a live file alone.

The implemented adapter is filesystem-based: its safe backup procedure is a complete stopped-workspace copy. `tests/test_capacity_benchmark.py` exercises that procedure through the benchmark CLI, with real HTTP and a new host on a separately restored directory; it checks the original selection, complete evidence and original score run. This is not a live backup, database-backup qualification or power-loss test. See [release qualification](release-qualification.md) for the operator procedure and upgrade exclusions.

## Literal fixtures in the built browser

`tools/qualify_literal_browser.py` qualifies one ticket's literal fixture in the built application. Its scenario in `tools/literal_scenarios.py` imports the literal and saves the reviewed pipeline over public HTTP. The built browser then reopens it, which requests every saved action again, and must show the scenario's expected texts. These are values written in the ticket's HTTP test from the literal rows.

The analyst then saves a revision and downloads both exports. The browser-saved manifest must hold the HTTP-saved outputs unchanged. The service process is then replaced, and a fresh browser must download byte-identical exports.

```text
python tools/qualify_literal_browser.py --scenario issue107 --output receipt.json \
    --node NODE --playwright PLAYWRIGHT_INDEX_MJS --chrome CHROME
```

The web app is rebuilt first. Both browser tools refuse to run on a build older than the web sources. `tests/test_literal_browser_scenarios.py` runs every scenario's HTTP setup in each test run.

## Human release checklist

On the supported Windows target, a novice follows the README, imports the synthetic event-history input, asks a useful question, compares context, switches to map/matrix/variants, opens full evidence, optionally scores, saves, stops and reopens. Repeat using keyboard/table paths and recover from one intentional error.

Record the build/runtime/assets, supported options, actual failures and capacity limits. Measured workloads and their limits are in [Measured capacity](capacity.md). Early Windows CI is required but does not substitute for this human journey. Private company mappings and expectations are validated locally by their owner after release qualification; test inputs and screenshots committed here remain synthetic.

The [release checklist](release-qualification.md) supplies literal browser checks, offline installation, keyboard/error recovery and stopped backup/restore steps. The [capacity tool](capacity.md) records HTTP timings and storage/memory evidence without imposing an invented performance budget. Matrix checks stay not implemented until the matrix exists; do not mark the full first journey passed by exercising a substitute view.
