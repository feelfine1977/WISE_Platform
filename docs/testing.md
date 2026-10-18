# Testing and qualification

Tests qualify a named scope. M0 foundation tests do not establish that CSV import, incident analytics, scoring, persistence or a Windows release is complete. Follow the development setup for the current test commands.

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

## Human release checklist

On the supported Windows target, a novice follows the README, imports the synthetic event-history input, asks a useful question, compares context, switches to map/matrix/variants, opens full evidence, optionally scores, saves, stops and reopens. Repeat using keyboard/table paths and recover from one intentional error.

Record the build/runtime/assets, supported options, actual failures and capacity limits. Measured workloads and their limits are in [Measured capacity](capacity.md). Early Windows CI is required but does not substitute for this human journey. Private company mappings and expectations are validated locally by their owner after release qualification; test inputs and screenshots committed here remain synthetic.
