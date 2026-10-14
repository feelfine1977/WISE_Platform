# 25: Assemble the separate historical notebook profile

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [127](https://github.com/feelfine1977/WISE_Platform/issues/127) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst loads the separately identified historical29-criterion/seven-layer/four-view profile, reviews each criterion’s actual measurement support and exports a reproducible full or explicitly partial assessment.

## Current platform foundation and missing analyst behavior

Historical norm/source helpers are references, not platform admission. Full closure needs all 29 actual bindings, seven layers/four views, exact source-compatible calibration/features and fresh current outputs; a partial manifest cannot qualify the full notebook.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Load and review the frozen 29-criterion historical catalogue
2. Review each source-compatible activity, time, resource and commercial measurement
3. Freeze maximum-absolute P95 on the full base population
4. Evaluate all four layer-balanced views using actual Method
5. Inspect exact evidence and the separately labelled quarter, replication and signature diagnostics
6. Review differences from stored notebook outputs
7. Export, save, actually restart and reopen the complete historical result

## Source evidence and limits

- WISE_BPIC19_full_analysis.ipynb, one-based cells3–6 (indices 2–5): real source,29checks, seven layers, four views and weights
- WISE_BPIC19_full_analysis.ipynb, one-based cells9,11–14,23–24,28,30,38,40,42,44: rates, backlogs, governance, quarter, association, signature, exposure and saved-output limitations
- Adjacent norm/bpic19_norm_v1.json andwise_eval/features.py, constraints.py, scoring.py: actual current source semantics, not frozen notebook execution dependencies
- WISE_12_10_2026.pdf, PDF pages 35–36: later paper ten criteria differs and cannot silently define historical 29

**Source-step cross-reference:** NB.C03, NB.C05, NB.C07, NB.C08, NB.C10, NB.C11, NB.C13, NB.C14, NB.C15, NB.C17, NB.C19, NB.C20, NB.C22, NB.C23, NB.C25, NB.C27, NB.C29, NB.C31, NB.C33, NB.C35, NB.C37, NB.C39, NB.C41, NB.C42. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE L1 (3): invoice-any (Record Invoice Receipt + Vendor creates invoice) and clearing apply to DF1/DF2/two-way; GR / SES presence applies to DF1/DF2. Minimum count 1; within-layer weights 1.2, 1.4, 1.1.
- SOURCE L2 (4): DF1 receipt before invoice-any (binary, weight 1.4); DF2 receipt before Remove Payment Block (binary, 1.5); two-way excludes GR / SES (1.2); Consignment excludes Clear Invoice (.8). Equal times satisfy; missing order endpoints are unavailable.
- SOURCE L3 (4): DF1 GR / SES → invoice-any target 10 days/width 20/weight 1.3; invoice-any → clearing in invoice flows 30/60/1.5; DF2 GR / SES → release 2/10/1.2; DF2 release → clearing 5/20/1.2. Minima are independent parsed minima; negative intervals are unavailable. The paper range filter is absent from the legacy recipe.
- SOURCE L4 (4): GR / SES count allowed 2/width 3/weight 1.2 in DF1/DF2/Consignment; approval changes 0/2/1.2 in all flows; recorded-invoice count 1/2/1 in invoice flows; payment-term changes 0/2/1 in all flows. Even the first approval change is positive despite the source label “repeats”.
- SOURCE L5 (5): binary Cancel Invoice Receipt (weight 1.2, invoice flows), Cancel Goods Receipt (1, DF1/DF2/Consignment), Delete Purchase Order Item (1.1, all), Vendor creates debit memo (1.3, all) and Vendor creates credit memo (1.1, all).
- SOURCE L6 (5): Change Price count 0/2/weight 1.4; Change Quantity 0/2/1.2; any debit/credit memo × normalized exposure (1.2); any price-change occurrence × normalized exposure (1); CV target .5/width 1/weight 1. CV applies to invoice flows; other L6 checks apply to all flows. These are commercial proxies, not amount reconciliation.
- SOURCE L7 (4): manual event count target 4/width 6/weight 1.4; distinct human resources 2/4/1.1; total event count 10/15/1; manual share .5/.5/.9. All apply to all flows under the historical prefix/nonempty classification.
- SOURCE view weights in L1–L7 order: Finance (.24,.08,.24,.06,.08,.24,.06); Logistics (.08,.24,.22,.22,.08,.04,.12); Compliance (.12,.30,.10,.06,.26,.06,.10); Automation (.06,.08,.10,.28,.06,.08,.34). Layer-balanced scoring normalizes within evaluable layer members, then among eligible positive-weight layers.
- PANEL PRODUCT DECISION: all 29 native bindings retain exact source-compatible recipes and original witnesses. Unknown or conflicting flow may use explicit three-valued scope in a corrected platform profile; this is not silently equated with the original helper’s unknown-category behavior.
- UNDEFINED EXECUTION GATE: saved kernel, dependency and norm versions are unfrozen. Current adjacent code is a reviewable reference, not proof of the exact stored execution.
- VERIFIED SOURCE DISCREPANCY: the complete original CSV inventory contains exact raw activity Change payment term (lowercase payment, singular), seven occurrences. The frozen norm selector is Change Payment Terms. The original helper slugifies case but retains the singular/plural difference: change_payment_term versus change_payment_terms. Preserve the historical zero count and selector warning; a corrected singular selector is a new norm, not a silent alias.

## Required core and conditional extensions

The approved bounded working behavior is required. Separately gated report methods are not automatically activated by this ticket.

## Extended user stories

### T25-S01

As an analyst reproducing the historical study, I want the original 29-criterion, seven-layer, four-view catalogue preserved so that the same dataset cannot hide a different norm.

**Preconditions:** Historical norm and current helper source are hashed and read as data

**User actions:**

1. Review every criterion and omission gate
2. Choose Finance, Logistics, Compliance or Automation
3. Confirm layer-balanced mode

**Expected outcome:** All 29 binding identities and source-compatible policies are explicit; partial support is not full historical parity.

**Acceptance:** T25-AC01, T25-AC02; the common integration criteria also apply.

### T25-S02

As a methodological reviewer, I want invoice-union, timestamp and resource recipes visible so that paper choices cannot replace the historical definitions silently.

**Preconditions:** Original labelled with its source measurement policies are available

**User actions:**

1. Inspect vendor-invoice union and independently selected minima
2. Compare prefix classification with strict paper full-match attribution
3. Read raw resource distinctness

**Expected outcome:** Historical and paper measurements remain separately identified and independently qualified.

**Acceptance:** T25-AC03, T25-AC04, T25-AC11; the common integration criteria also apply.

### T25-S03

As an analyst, I want global exposure calibration and commercial proxies frozen so that selecting a group does not change the constructed assessment.

**Preconditions:** Full base calibration membership and original value rows are available

**User actions:**

1. Review maximum-absolute P95 and CV
2. Inspect memo and price exposure products
3. Select a subset of stored scores

**Expected outcome:** Full-population cutoff, source compatibility and calibration identity remain unchanged.

**Acceptance:** T25-AC05, T25-AC06; the common integration criteria also apply.

### T25-S04

As a process-method expert, I want native results checked against an independent 29-criterion oracle so that decomposition equality cannot hide an incorrect measurement.

**Preconditions:** Literal original record fixtures and expected layer penalties are available

**User actions:**

1. Inspect all 29 states
2. Verify each of the four view scores
3. Cross the original record-to-native HTTP seam

**Expected outcome:** Every operator and view is qualified; unavailable case evidence is distinguished from an unimplemented operator.

**Acceptance:** T25-AC02, T25-AC07, T25-AC11; the common integration criteria also apply.

### T25-S05

As an analyst, I want historical quarter, replication and signature recipes separated from corrected meanings so that figures stay reproducible without overstating them.

**Preconditions:** Original timestamps, activities and order are retained

**User actions:**

1. Inspect sentinel quarters and the replication proxy
2. Compare exact sequences with first-occurrence signatures
3. Choose an explicitly identified compatibility or corrected recipe

**Expected outcome:** Each interpretation has its own identity; replication, human work and causation are not inferred.

**Acceptance:** T25-AC08; the common integration criteria also apply.

### T25-S06

As a study reviewer, I want discrepancies from stored notebook outputs visible so that saved execution counters and old figures do not count as current execution proof.

**Preconditions:** Fresh full source run and stored source outputs are separately identified

**User actions:**

1. Compare rates with their own denominators
2. Inspect the 68.7% versus 88.9% conflict
3. Read the current output manifest

**Expected outcome:** Source claims and current results remain distinct; no tuning or synthetic fallback forces a match.

**Acceptance:** T25-AC09; the common integration criteria also apply.

### T25-S07

As a returning analyst, I want the complete historical result reopened after a real restart so that a partial run cannot masquerade as full qualification.

**Preconditions:** All 29 operators and full source saved artifacts are available

**User actions:**

1. Review and save each visible view with its own reference
2. Export all case, group and calibration artifacts
3. Stop and restart the actual service
4. Reopen original witnesses

**Expected outcome:** Full historical identities, memberships and values survive the real HTTP and browser seam.

**Acceptance:** T25-AC10; the common integration criteria also apply.

## Independent literal inputs

These are explicitly synthetic test inputs, separate from published source totals and real-data qualification. Expand any declared label shorthand using the exact binding legend before import.

### F29-Raw: independent four-flow original-record fixture

These are synthetic original records, not BPIC19 rows. F29 labels are fixture references; the preparation receipt maps them to service row IDs and original positions. No supplied code is executed to author the expectations. Use the declared historical catalogue, all 29 criteria, all four views, layer-balanced mode and gamma 0 for the baseline; separately check gamma 20 without changing scores or reference.

Original columns, in order: 0: `case concept:name`, 1: `case Purchasing Document`, 2: `case Item`, 3: `case Item Category`, 4: `case Goods Receipt`, 5: `case GR-Based Inv. Verif.`, 6: `case Item Type`, 7: `case Company`, 8: `case Spend area text`, 9: `event concept:name`, 10: `event time:timestamp`, 11: `event org:resource`, 12: `event Cumulative net worth (EUR)`.

Roles: source_case=0, purchasing_document=1, item=2, item_category=3, goods_receipt=4, gr_based_iv=5, item_type=6, company=7, spend_area=8, activity=9, timestamp=10, resource=11, net_worth=12. Use ISO8601 wall-clock timestamps exactly as supplied, no timezone conversion, original record order as the declared tie rule. Rows are retained; counts use all labelled records. All case fields are constant within each item. A/B are mixed-flow siblings in document docD.

Each row expands the case dictionary below plus its activity, timestamp, resource and value. No creation record is inferred for case A.

| Case | Item ID | Document | Item | Category | GR | GR-based IV | Item Type | Company | Spend | Every-row value EUR |
|---|---|---|---|---|---|---|---|---|---|---|
| A | docD_00010 | docD | 00010 | 3-way match, invoice after GR | TRUE | TRUE | Standard | 0000 | Packaging | 10 |
| B | docD_00020 | docD | 00020 | 3-way match, invoice before GR | TRUE | FALSE | Standard | 0000 | Packaging | 20 |
| C | docE_00010 | docE | 00010 | 2-way match | FALSE | FALSE | Limit | 0000 | Logistics | 30 |
| D | docF_00010 | docF | 00010 | Consignment | TRUE | FALSE | Consignment | 0000 | MRO | 40 |

| Fixture row | Case | Activity | Timestamp | Resource | Value EUR |
|---|---|---|---|---|---|
| F29-A1 | docD_00010 | Record Goods Receipt | 2018-01-01T00:00:00 | user_1 | 10 |
| F29-A2 | docD_00010 | Vendor creates invoice | 2018-01-11T00:00:00 | user_2 | 10 |
| F29-A3 | docD_00010 | Record Invoice Receipt | 2018-01-21T00:00:00 | UNKNOWN | 10 |
| F29-A4 | docD_00010 | Clear Invoice | 2018-03-22T00:00:00 | batch_1 | 10 |
| F29-B1 | docD_00020 | Create Purchase Order Item | 2018-01-01T00:00:00 | user_1 | 20 |
| F29-B2 | docD_00020 | Record Invoice Receipt | 2018-01-02T00:00:00 | user_1 | 20 |
| F29-B3 | docD_00020 | Record Goods Receipt | 2018-01-03T00:00:00 | batch_1 | 20 |
| F29-B4 | docD_00020 | Remove Payment Block | 2018-01-05T00:00:00 | batch_1 | 20 |
| F29-B5 | docD_00020 | Clear Invoice | 2018-01-10T00:00:00 | user_2 | 20 |
| F29-C1 | docE_00010 | Create Purchase Order Item | 2018-01-01T00:00:00 | user_3 | 30 |
| F29-C2 | docE_00010 | Vendor creates invoice | 2018-01-02T00:00:00 | user_3 | 30 |
| F29-C3 | docE_00010 | Record Invoice Receipt | 2018-01-03T00:00:00 | batch_1 | 30 |
| F29-C4 | docE_00010 | Record Goods Receipt | 2018-01-04T00:00:00 | user_4 | 30 |
| F29-C5 | docE_00010 | Clear Invoice | 2018-01-05T00:00:00 | user_4 | 30 |
| F29-D1 | docF_00010 | Create Purchase Order Item | 2018-01-01T00:00:00 | batch_1 | 40 |
| F29-D2 | docF_00010 | Record Goods Receipt | 2018-01-02T00:00:00 | batch_1 | 40 |
| F29-D3 | docF_00010 | Cancel Goods Receipt | 2018-01-03T00:00:00 | batch_1 | 40 |
| F29-D4 | docF_00010 | Delete Purchase Order Item | 2018-01-04T00:00:00 | batch_1 | 40 |
| F29-D5 | docF_00010 | Clear Invoice | 2018-01-05T00:00:00 | batch_1 | 40 |

Raw historical expectations:

- Event counts A/B/C/D = 4/5/5/5. Invoice-any counts = 2/1/2/0; recorded-invoice counts = 1/1/1/0; GR/SES counts = 1/1/1/1; clearing counts = 1/1/1/1. Cancel Goods Receipt and Delete Purchase Order Item occur once in D. Every other catalogue activity count is zero.
- Invoice-any→clearing durations A/B/C = 70/8/3 days. A goods→invoice-any = 10 days. B goods→release = 2 days and release→clearing = 5 days. Applicable order checks are satisfied. Out-of-scope quantities are not assessed.
- Historical human-event counts A/B/C/D = 3/3/4/0; raw distinct-human identities = 3/2/2/0; manual shares = 3/4,3/5,4/5,0. UNKNOWN in A is classified human by the explicit legacy recipe; strict paper effort for A is unavailable.
- CV is zero for each item because all its raw values are constant. Item maximum absolute values are 10/20/30/40. Linear P95 is 38.5 (position 2.85 in sorted four-value list); normalization gives 20/77,40/77,60/77,1. Fit membership is exactly A,B,C,D, preserved during subset inspection. Memo and price occurrence proxies are zero for all four items.

Per-criterion deviation oracle below: OOS means native out_of_scope with unavailable deviation; every other cell is native evaluated. No unknown input or unavailable in-scope measure occurs under this legacy baseline. Expected evaluated/scope counts A/B/C/D are 24/25/20/16 and native weighted evidence coverage is 1 for all.

| Criterion ID | A DF1 | B DF2 | C two-way | D Consignment |
|---|---|---|---|---|
| c_l1_invoice_present | 0 | 0 | 0 | OOS |
| c_l1_clear_invoice_present | 0 | 0 | 0 | OOS |
| c_l1_goods_or_ses_present | 0 | 0 | OOS | OOS |
| c_l2_df1_invoice_after_goods | 0 | OOS | OOS | OOS |
| c_l2_df2_release_after_goods | OOS | 0 | OOS | OOS |
| c_l2_2way_no_goods_expected | OOS | OOS | 1 | OOS |
| c_l2_consignment_no_clear_invoice | OOS | OOS | OOS | 1 |
| c_l3_df1_goods_to_invoice_days | 0 | OOS | OOS | OOS |
| c_l3_invoice_to_clear_days | 2/3 | 0 | 0 | OOS |
| c_l3_df2_goods_to_rpb_days | OOS | 0 | OOS | OOS |
| c_l3_df2_rpb_to_clear_days | OOS | 0 | OOS | OOS |
| c_l4_goods_fragmentation | 0 | 0 | OOS | 0 |
| c_l4_change_approval_repeats | 0 | 0 | 0 | 0 |
| c_l4_repeated_invoice_receipt | 0 | 0 | 0 | OOS |
| c_l4_change_payment_terms_repeats | 0 | 0 | 0 | 0 |
| c_l5_cancel_invoice_receipt | 0 | 0 | 0 | OOS |
| c_l5_cancel_goods_receipt | 0 | 0 | OOS | 1 |
| c_l5_delete_item | 0 | 0 | 0 | 1 |
| c_l5_debit_memo | 0 | 0 | 0 | 0 |
| c_l5_credit_memo | 0 | 0 | 0 | 0 |
| c_l6_change_price | 0 | 0 | 0 | 0 |
| c_l6_change_quantity | 0 | 0 | 0 | 0 |
| c_l6_high_exposure_memo | 0 | 0 | 0 | 0 |
| c_l6_high_exposure_price_change | 0 | 0 | 0 | 0 |
| c_l7_manual_touches | 0 | 0 | 0 | 0 |
| c_l7_distinct_human_resources | 1/4 | 0 | 0 | 0 |
| c_l7_total_events | 0 | 0 | 0 | 0 |
| c_l7_manual_share | 1/2 | 1/5 | 3/5 | 0 |
| c_l6_bal_networth_volatility | 0 | 0 | 0 | OOS |

| Case | L1 | L2 | L3 | L4 | L5 | L6 | L7 |
|---|---|---|---|---|---|---|---|
| A | 0 | 0 | 5/14 | 0 | 0 | 0 | 29/176 |
| B | 0 | 0 | 0 | 0 | 0 | 0 | 9/220 |
| C | 0 | 1 | 0 | 0 | 0 | 0 | 27/220 |
| D | unavailable | 1 | unavailable | 0 | 7/15 | 0 | 0 |

For each view, score is 1 minus the eligible-layer-weighted mean of the above independently specified layer penalties; layers without any applicable evaluable criterion contribute no layer score. Expected native scores:

| Case | Finance | Logistics | Compliance | Automation |
|---|---|---|---|---|
| A | 0.9043993506 | 0.9016558442 | 0.9478084416 | 0.9082629870 |
| B | 0.9975454545 | 0.9950909091 | 0.9959090909 | 0.9860909091 |
| C | 0.9126363636 | 0.7452727273 | 0.6877272727 | 0.8782727273 |
| D | 0.7743589744 | 0.6038095238 | 0.4598290598 | 0.8714285714 |

Reference and group oracles: four scored items give each view the arithmetic reference (A+B+C+D)/4. Document docD uses A/B mean and scored count 2; docE and docF each use count 1. Company 0000 × Packaging has A/B, Logistics has C and MRO has D. Count PI is n×max(reference−group mean,0), using these explicit fractions. Gamma 20 keeps scores/reference fixed and scales each gap by n/(n+20). Native signed driver sums reconcile before final positive clipping. No exposure-weighted reference is substituted.

Additional exact edge fixtures already specified in the linked acceptance cases cover missing labels and binary witnessed presence (T10-AC03/T12-AC08), absent/reversed/tied/sentinel endpoints (T11-AC03–05 and T25-AC04), commercial sample-CV and proxy products (T25-AC06), and exact synthetic singular/plural matching (T25-AC11). Each mutation has separately recorded source/preparation/calibration identities. Positive/saturation boundaries of every count and threshold family require an independently authored original-row expansion; the prepared arithmetic vector remains a separate downstream check, not a substitute for these raw fixtures.

## Acceptance criteria

### Approved baseline retained

- [ ] **25-B01.** Finance, Logistics, Compliance and Automation and layer-balanced mode retain resolved weights and the historical source identity.
- [ ] **25-B02.** Each29 criterion has a raw-source measure/witness, exact scope, deviation policy and admitted Method binding; unsupported criteria are listed in an omission manifest.
- [ ] **25-B03.** Expose max-absolute exposure calibration, quarter, replication, attribution and signature recipes as historical compatibility choices; corrected meanings create separate profiles.
- [ ] **25-B04.** A partial profile cannot claim full29-check numeric parity; full activation requires every requested operator and a complete provenance receipt.
- [ ] **25-B05.** Independent literal checks and clean current-run output/save/restart exclude stale figures and saved execution counters as execution proof.

### Exact domain and analyst acceptance

- [ ] **T25-AC01.** Given the frozen historical catalogue, When its full profile is loaded, Then 29 criteria occupy seven layers in counts 3+4+4+4+5+5+4, with exact Finance, Logistics, Compliance and Automation layer weights and layer-balanced mode. All 29 raw operator bindings are admitted. A partial 17-criterion or other omission profile is interim and cannot close full ticket 25.
- [ ] **T25-AC02.** Given any of the 29 source criteria, When admission is reviewed, Then exact activity selector, flow scope, threshold, width, within-layer weight, raw measurement, availability reason, original witnesses and actual native binding are visible. Unsupported meaning produces an omission manifest and distinct partial identity. Unavailable evidence in an individual case is different from an unimplemented operator.
- [ ] **T25-AC03.** Given goods receipt on 1 January, vendor invoice on 11 January, recorded invoice on 21 January and clearing on 22 March 2018, When both profiles measure the history, Then historical invoice-any-to-clearing is 70 days using the vendor-invoice witness, while paper C04 is 60 days using the recorded-invoice witness. Historical goods-to-invoice-any is 10 days. Record Subsequent Invoice does not silently replace Vendor creates invoice in the historical union.
- [ ] **T25-AC04.** Given resources user_1, user_2, UNKNOWN and batch_1 on those four records, When historical source-compatible effort is measured, Then human-touch count is 3, raw distinct-human-resource count is 3 and manual share .75; distinct-resource deviation is .25 and manual-share deviation .5. Paper strict C09/C10 are unavailable. Historical classification excludes empty/nan/none/null and the batch prefix, while distinctness retains original resource strings. A parsed 1948 minimum is eligible under the historical timestamp recipe and unavailable under the paper range recipe.
- [ ] **T25-AC05.** Given a full calibration population with item maximum absolute values 10 and 20 EUR, When the linear 95th percentile is frozen, Then q95=19.5 and normalized exposures are 10/19.5 and 1. Exact fit membership and value rows are retained. Subset inspection preserves cutoff 19.5. Historical missing-value fill-zero is an explicit compatibility policy, not permission to turn unavailable exposure into zero in another financial profile.
- [ ] **T25-AC06.** Given historical CV defined as sample SD (ddof=1) divided by mean clipped below at 1e-6, When values are 10 and 20, Then sample SD=√50, mean=15, CV=√50/15≈.47140452 and CV deviation=0. A singleton 10 has SD=0 and CV=0. A zero or negative mean uses the declared clipped denominator and does not establish amount reconciliation. Memo/price occurrence multiplied by frozen normalized exposure is a separately witnessed numeric proxy, with both activity and value provenance.
- [ ] **T25-AC07.** Given independently authored original-record fixtures covering all four purchasing flows, complete and missing endpoints, reversed/tied times, known zero/positive counts, historical resource classification, commercial proxies and each of the 29 exact selectors, plus a SEPARATE prepared-attribute arithmetic fixture with DF1 layer penalties L1–L7=(0,1,.5,0,1.3/5.7,2.35/5.8,2.7/4.4), When actual native Method evaluates every admitted criterion and all four views through real HTTP, Then every criterion’s raw value, availability, flow scope, deviation and original row IDs match an independent literal oracle. In the separate arithmetic fixture, each view score equals 1 minus the dot product of its seven declared layer weights and that vector, coverage=1 and contributions sum to 1−score. The arithmetic vector alone is not proof of a physically consistent original event history or raw-adapter equivalence. Exact counts/states/IDs and finite numeric tolerance 1e-8 apply; a flat shortcut is refused. The complete original rows, roles, frozen calibration, all 29 criterion cells and four-flow score expectations are specified by companion fixture F29-Raw under Independent literal inputs.
- [ ] **T25-AC08.** Given a parsed 1948 case start, activity sequence A, B, A and tied event times, When historical compatibility artifacts are computed, Then the quarter may be 1948Q1; exact sequence remains A, B, A while its first-occurrence signature is A, B; events divided by distinct parsed timestamps is labelled a replication proxy rather than verified duplicate count. Corrected sentinel, tie, deduplication and value-band recipes require separate identities.
- [ ] **T25-AC09.** Given a fresh current full source 29-criterion run, When it is compared with stored notebook output, Then all 251,734 items and 76,349 documents have qualification receipts and the full four-view calculation is checked independently. Stored means Finance .819, Logistics .817, Compliance .871 and Automation .844, and Packaging Finance PI 2289.2907, are provisional diagnostics with rounding and source-environment qualifications. The 68.7% narrative versus 88.9% evaluated-lag output and 64.7% all-case firing rate retain separate denominators. Saved execution counters, suppressed warnings and accumulated figures are not proof of the current run.
- [ ] **T25-AC10.** Given all 29 admitted bindings and the exact full source historical run in the matching built browser, When the analyst reviews all four view definitions/references, inspects source evidence, exports and saves each visible view’s own run, stops the actual service process, observes its exit, starts a distinct process and reopens through HTTP and the browser, Then every saved view retains its definition/reference/calibration/run identity, exact member/witness/state sets and finite native numbers within 1e-8. Missing or checksum-corrupt artifacts refuse explicitly. No partial profile, internal-only full run or visual-only check closes full ticket 25.
- [ ] **T25-AC11.** Given a synthetic original event labelled exactly Change payment term, When the frozen historical Change Payment Terms selector is evaluated using its source slug policy, Then the plural-selected count is 0 and deviation=0. When a separately reviewed corrected singular-selector norm runs with allowed count 0 and width 2, Then count=1 and deviation=.5, with a new norm/run identity. The verified original inventory contains seven singular raw occurrences; no raw row/event identifiers need be published. Preserve the original historical catalogue rather than silently aliasing spellings.

### Public behavior, evidence and durability

- [ ] **25-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **25-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **25-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **25-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **25-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **25-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **25-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** historical source and all 29 criterion bindings, seven layers and four views, layer-balanced mode, invoice union and prefix attribution, CV/quarter/replication/signature policies, frozen P95 calibration.

## Required qualification receipts

- Exact source-byte hash, original record positions/IDs and immutable preparation/mapping/role identities
- Named whole-item population membership/hash, base reference membership/hash, document dictionary, four-flow classification and unknown/conflict/exclusion receipts
- Compiled norm document/fingerprint, requested and admitted criterion IDs, omission manifest, source/profile version, view and actual raw/effective weights
- Actual packed wise-pm artifact hash/version/source commit/qualification state and matching API/browser build identities
- Native scope/reason/deviation/score/penalty/contribution outputs, evidence coverage numerator/denominator and unavailable support
- Grouping keys/reducers, scored-member identities, arithmetic reference, multiplier/unit, gamma/minimum support/tie policy and calibration identity
- Run identity, original endpoint/count/resource/value witnesses, current-run export manifest and persisted case/group artifacts
- Real HTTP request/answer records, built-browser evidence interaction, actual service stop/new-process restart and reopened frozen artifact checks
- Independent synthetic F29-Raw roles, original records, frozen P95 fit members, all 29 per-criterion states and four-flow literal expectations; verified raw activity inventory warning without publishing original BPIC event IDs

Each receipt identifies the candidate source/build, input and definition identities, independently expected versus actual values, public HTTP and built-browser actions, stable export/save references, observed first-process exit and distinct second-process reopening. Component or synthetic tests do not establish full-source capacity; report the elapsed time, peak memory and output/payload sizes for each full-source action that this ticket requires.

## Remaining gates and closure rule

- Timestamp range, unknown flow, missing-value and resource compatibility are explicit meaning-bearing fields; correcting them changes the profile even with unchanged source bytes.
- All 29 operators, all four views, exact full source and actual fresh-process reopening are required for full closure; partial admission remains interim.
- Commercial and resource proxies do not establish amount reconciliation, authorized roles or avoidable work.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #21, #36, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** #111 — Review source-witnessed item-value definitions, #113 — Evaluate paper timing criteria with endpoint evidence, #114 — Evaluate paper rework and effort criteria, #119 — Compare exact variants with a named signature

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
