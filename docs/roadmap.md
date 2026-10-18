# Product roadmap

The first complete application is a private, local incident-investigation workspace. An analyst imports an event-history CSV, selects groups and periods through linked charts, compares context, explores the process map, transition matrix and variants, inspects full histories, optionally applies WISE expectations, and saves the investigation for reopening.

These are capability gates, not delivery dates. A foundation or component test does not qualify the complete application.

For the implemented candidate and named automated evidence, see [current status](status.md). Time charts, comparisons, one timing expectation and durable saved questions now exist, but partial M1 capability is not completion of the gates below.

## Delivery gates

| Gate | Outcome | Completion evidence |
| --- | --- | --- |
| **M0 — Application foundation** | Clean application layout, local host, health contract, generated boundary, documented development and early Windows checks. | Start/health/contract tests and honest unavailable-capability status. No incident-analysis claim. |
| **M1a — Trustworthy local data** | CSV interpretation, quality decisions, original records, prepared representation, context, complete-case selection and typed query contracts. | Small synthetic cases with independently specified exact membership, sequence, time and missingness results. |
| **M1b — Linked investigation** | Unscored charts, map, transition matrix, variants, paired context profiles and complete evidence under one revision. | Human investigation and exact cross-view counts, keyboard access, pending/error/undo recovery. |
| **M1c — Expectations and continuity** | Local incident expectations, qualified Method scoring, actual score-to-map evidence, clickable witnesses, durable scored or unscored investigations. | Definition/coverage/witness checks, stop/reopen, stale-source refusal, backup/recovery. |
| **M1d — Windows local release** | One complete download, documented approved setup, built web assets, local/offline data use and a supported capacity tier. | Actual Windows install/start/stop/restart and end-to-end synthetic incident investigation; runtime and capacity limits recorded. |
| **M2 — Deeper diagnosis and improvement** | Levels, temporal patterns, reviewed models, pilot measurement and qualified uncertainty. | Each method adds a usable journey and its own assumptions/evidence gate. |
| **M3 — Validated advanced methods** | Object relationships, drift, simulation, prediction and multidimensional context. | Domain/model validation, temporal evaluation and complete provenance. |
| **M4 — Optional team extension** | Shared investigations, reviewed monitoring/actions, assistance and connectors. | Explicit deployment/data-access decisions, enforced permissions and qualified adapters. |

M1 is one release gate with staged implementation. Scoring is optional while exploring but must be locally available in that first complete release. Descriptive context comparison is an M1 capability, not dependent on prediction or automated explanation. Identity/artifact/job contracts begin in M1a; coherent request handling is qualified before M1b, without waiting for full M1c persistence.

## Capabilities and priorities

**P0** completes the first incident journey. **P1** deepens it after the usable release. **P2** requires validated additional models or relationships. **P3** expands deployment and collaboration only when needed. The catalog preserves 48 capabilities; a row is not a separate application or service.

| ID | Capability | Priority / acceptance focus |
| --- | --- | --- |
| F01 | One versioned full application download | P0: compatible application/assets/dependencies and one documented start. |
| F02 | External local workspace and database | P0: program updates do not lose investigations; restart opens the same workspace. |
| F03 | Offline private analytics | P0: local analysis uses local assets after setup; company records remain on the machine. |
| F04 | CSV format and field-role mapping | P0: delimiter, encoding, IDs, activity/state, time and context are explained locally. |
| F05 | Explicit clock and record ordering | P0: precision, timezone and tie authority feed every view consistently. |
| F06 | Quality decisions and original rows | P0: missingness/duplicates inspectable; preserved records and preparation identity. |
| F07 | Named incident representations | P0: activity, state or assignment projection with honest unsupported cases. |
| F08 | Anchored context and missingness | P0: qualified opening context; latest/ever only with a named supported policy. |
| F09 | Snapshot cutoff and endpoint coverage | P0: absence, usable endpoints and observation age remain distinct. |
| F10 | Exact complete-incident selection | P0: common predicate semantics, identities and full histories across views. |
| F11 | Preview, undo and parent navigation | P0: highlight/refinement/reverse/rebase are distinct and reversible. |
| F12 | Selectable categorical charts | P0: groups, service, priority and available attributes select the same incidents. |
| F13 | Duration distributions and tail selection | P0: usable interval support, quantiles and common comparison bins. |
| F14 | Time trends and incident-start selection | P0: periods preserve later records and expose missing start anchors. |
| F15 | Activity/state/assignment transition matrix | P0: incident support, passages, outgoing frequency and lag are labelled separately. |
| F16 | Actual sequence variants | P0: repeats/order, top-N/other support and exact complete-case membership. |
| F17 | Supplied process map | P0: selected population, typed values, readable direction and evidence actions. |
| F18 | Honest detail and mark inspection | P0: visual detail does not change cases; rule choice and hidden inventory are usable. |
| F19 | Frozen-parent target/comparator profiles | P0: retained filters/eligibility, exact groups, missing categories and named roles. |
| F20 | Concentration and outcome measures | P0: explicit conditional denominators, counts/shares/pp and optional ratios; zero/tiny states. |
| F21 | Inspect both sides and reverse roles | P0: category inspection retains the comparator and offers counterexamples. |
| F22 | Explicit group comparison | P0: comparable definitions/scales, support/overlap and meaningful strata. |
| F23 | Period and follow-up comparison | P0: start cohorts, common definitions and observed exposure/coverage. |
| F24 | Complete case and source evidence | P0: full records, context changes, source rows and endpoint witnesses. |
| F25 | Clickable bookmarks and two-case comparison | P0: accessible witness navigation, complete histories and useful differences. |
| F26 | Local goal and expectation authoring | P0: optional intent-to-reviewed definition with versioned scope/clock/target. |
| F27 | Incident WISE scoring | P0: resolution, meaningful transfers and reopening; raw measures, applicability and witnesses. |
| F28 | Durable investigations and source freshness | P0: exact definitions/populations/roles/evidence persist; refresh makes a new revision. |
| F29 | Coherent async, cancellation and recovery | P0: obsolete success/error refused, explicit pending state and safe publication. |
| F30 | Keyboard and table accessibility | P0 in every view: equivalent select/compare/evidence/save operations. |
| F31 | Analyst documentation and guided test | P0: version-matched guide, feature list, synthetic pictures and recovery steps. |
| F32 | Workspace upgrade, backup and refusal | P0: consistent restoration, compatible schema and explicit unsupported state. |
| F33 | Stage hierarchy and semantic drill-down | P1: stage-to-case exploration preserves populations and relation meaning. |
| F34 | Spectrum, calendar and detailed timing views | P1: patterns select complete cases with visible aggregation and missingness. |
| F35 | Reviewed models and conformance | P1: observed/discovered/reference models and alignment evidence distinguished. |
| F36 | Pilot and control-plan workspace | P1: frozen baseline, predictions and outcome/process/balancing measures. |
| F37 | Explicit inferential uncertainty | P1: declared population, independence, multiplicity and qualified method. |
| F38 | Frozen target sensitivity | P1: same behavior under different expectations; classification change is not improvement. |
| F39 | Drift and changing process mix | P2: logging/mix alternatives, reference windows and reproducible detector evidence. |
| F40 | Linked business objects | P2: object perspectives, shared events, attribution and provenance reconcile. |
| F41 | Calibrated simulation and scenarios | P2: validated assumptions, held-out observations and no guaranteed savings. |
| F42 | Local predictive monitoring | P2: prediction horizon, temporal evaluation, calibration and failure cases. |
| F43 | Rich context cubes and relationships | P2: explicit dimensions/aggregation and overlapping memberships without double counts. |
| F44 | Shared investigations and permissions | P3: enforced access, protected evidence and review revisions. |
| F45 | Refresh, monitoring and reviewed actions | P3: explicit snapshot comparison and retained evidence before action review. |
| F46 | Optional evidence-backed assistance | P3: inspectable proposals, assumptions and evidence under user review. |
| F47 | Connectors and interchange | P3: explicit source rights, schema/version and local/remote data boundaries. |
| F48 | Measured capacity tiers | P0 baseline, P1 larger tiers: actual latency/memory/disk limits, never assumed scale. |

## First acceptance journey

Use synthetic incidents to find a delay tail, inspect reassignment/reopening, compare groups and periods with follow-up coverage, and compare context between recorded-resolution and no-recorded-resolution cohorts. Open a matrix pair or actual variant, inspect complete histories and a counterexample, optionally define a local expectation, then save, stop and reopen the same finding.

A missing resolution record does not establish an unresolved business incident. A vendor/group association is not a cause or performance verdict. Every useful finding must retain the population, interpretation, evidence and limits needed for review.

## Integration and setup conditions

The linked-views gate requires an eligible Flow release whose tests/reference rendering and host integration are qualified. Readable labels for removed activities and attribute filters, stable activity positions across refinements, explicit rearrangement, and accessible evidence actions are acceptance conditions.

Windows source qualification uses the documented locked dependency installation and browser build with compatible Python and Node. CI also builds an offline-installable Windows x64 bundle with built assets, runtime wheels and the official Python installer. Its automatic installed HTTP checks are artifact evidence, not a completed human journey. Follow the [release checklist](release-qualification.md) for actual installation, browser/offline, recovery and capacity receipts; those gates remain pending.

Scored selections retain their named run population/calibration and Method applicability; subset rescoring creates a new run. Graded values and library-defined affected support remain distinct from descriptive threshold partitions.
