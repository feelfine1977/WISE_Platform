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

## First use, the own workspace and the import wizard in the built browser

These tools take the same arguments and refuse a stale build in the same way. Each starts the service as its own process over temporary folders and writes a receipt of checks and identities only.

- `tools/qualify_first_use.py` (#2, #3): an empty workspace, the packaged example S0 with its counts, one incident opened by keyboard and another by pointer, then an actual restart with the same identities and no second example read.
- `tools/qualify_default_workspace.py` (#47): the service without a workspace, for synthetic users. It covers creation at first launch, reuse, a launch override, a Data-area override with a refused foreign folder, an unwritable default recovered by Try again, and a damaged default recovered by another folder. Every refused folder must keep its bytes.
- `tools/qualify_import_wizard.py` (#4): on a 1366 × 768 window, the guide's synthetic example, then the invented files of `tests/fixtures/import-journey` against their own `expected.json`:
  - a wrong delimiter is corrected;
  - roles are chosen, and the reading and its confirmation are done by keyboard;
  - "What WISE understood" is checked;
  - the incidents and their records are opened;
  - a saved investigation is made, and a corrected reading is published as a new preparation, after which the saved investigation reopens on its own;
  - a malformed file is refused and never published.
- `tools/qualify_chronology.py` (#5): the invented `tests/fixtures/chronology/chronology.csv` against its own `expected.json`, in two phases.
  - Review:
    - the summary names the clock, the order authority, where the cutoff came from, and each policy with its version;
    - by keyboard, the evidence of a tie whose sequence numbers disagree with the times, of records without activity label, and of a date-only time (not readable, never midnight);
    - the path over missing labels says what it passes over, and no end is made after an unlabelled last record;
    - the focus returns to the preparation control;
    - a reading without the sequence number is compared with the first and published as its own preparation.
  - Reopen, after an actual restart: a fresh browser opens the first preparation, which keeps its order.
- `tools/qualify_ymd_slash.py` (#52): the invented `tests/fixtures/ymd-slash/ticketing.csv`, in the year-first slash shape, against its own `expected.json`.
  - It is read first with a format that reads none of its times. The summary and the investigation say why no order, path or variant follows, and lead back to the Data area.
  - There, the year-first format is offered with how many values it reads. The new reading is compared with the first and published; it has paths, and its original cells keep their fractional seconds.

- `tools/qualify_selection.py` (#6): the invented `tests/fixtures/explorer/core-v1.csv` against the hand-written `tests/fixtures/selection-journey/expected.json`.
  - A highlighted path's step is previewed with what it would keep, before anything is taken.
  - Taken, it shows the whole selection's counts, how steps combine and why some incidents are not evaluable. The preview and the step share one identity.
  - An incident is opened by keyboard, and the focus returns to it.
  - A second step keeps nothing and says so.
  - Undo twice restores exactly the earlier identities.

- `tools/qualify_incident_numbers.py` (#57): keeping incidents by their numbers in `core-v1.csv`, against `tests/fixtures/selection-journey/incident-numbers.json`.
  - An unknown or a repeated number refuses the whole entry, and nothing is asked.
  - An entry is previewed and taken: the chip, the counts, and every record of the kept incidents, the unlabelled ones included.
  - Another order of the same numbers gives the same identity.
  - Kept against removed in Compare names the same groups.
  - The investigation is saved, then reopened after an actual restart with the same chip and identity. Clear all and Undo return exactly.

- `tools/qualify_opening_context.py` (#7): the Context panel over `core-v1.csv`, against `tests/fixtures/selection-journey/opening-context.json`.
  - It checks each value, with a missing value apart from the text Unknown.
  - It checks what is said of unreadable and tied first records, of the totals, and of the latest and "ever" choices not offered.
  - A missing value, the text Unknown and a recorded value are kept by keyboard; a kept incident opens with all its context changes.

`tools/qualify_local_ymd_sample.py` is run by the owner on a local year-first export of their own, such as a public helpdesk benchmark sample, with its three role columns named by header:

- It reads the file through the product's operations in a temporary workspace.
- Its receipt holds the file's SHA-256, the reads of each format, and records, usable times, incidents in a known order, paths and variants, both with the year-first format and with every time unreadable.
- It holds no path, header or value.

## Human release checklist

On the supported Windows target, a novice follows the README, imports the synthetic event-history input, asks a useful question, compares context, switches to map/matrix/variants, opens full evidence, optionally scores, saves, stops and reopens. Repeat using keyboard/table paths and recover from one intentional error.

Record the build/runtime/assets, supported options, actual failures and capacity limits. Measured workloads and their limits are in [Measured capacity](capacity.md). Early Windows CI is required but does not substitute for this human journey. Private company mappings and expectations are validated locally by their owner after release qualification; test inputs and screenshots committed here remain synthetic.

The [release checklist](release-qualification.md) supplies literal browser checks, offline installation, keyboard/error recovery and stopped backup/restore steps. The [capacity tool](capacity.md) records HTTP timings and storage/memory evidence without imposing an invented performance budget. Matrix checks stay not implemented until the matrix exists; do not mark the full first journey passed by exercising a substitute view.
