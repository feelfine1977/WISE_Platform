# BPIC19: what the analyst needs before a process map or score

Status: approved beginning-workflow requirements, acceptance expanded after the source/ticket review on 14 October 2026; runtime qualification remains open. Production behavior was inspected at source `3d76a578703102d969792bc1be1ef8f272831520`; the proposed additions have not been implemented or browser-qualified.

The initial draft gave generic context filtering too much credit. Preserving a column in a CSV and offering a manual predicate are useful foundations, but they do not deliver the reviewed beginning of the analyst's workflow. BPIC19 analysis begins with business identity, source profiling, purchasing-flow classification and population decisions. Model discovery and WISE scoring follow those decisions.

## The four types are supplied data

The primary field is **case Item Category**. Classify PO items by the supplied category before inspecting their observed order. Goods Receipt and GR-Based Invoice Verification are configured settings; neither means that a corresponding event was actually observed.

| Purchasing flow | Exact category value | Goods Receipt flag | GR-Based IV flag | Distinct PO items |
|---|---|---|---|---:|
| Three-way, invoice after goods receipt | `3-way match, invoice after GR` | true | true | 15,182 |
| Three-way, invoice may precede goods receipt | `3-way match, invoice before GR` | true | false | 221,010 |
| Two-way, no goods receipt required | `2-way match` | false | false | 1,044 |
| Consignment, item invoicing handled elsewhere | `Consignment` | true | false | 14,498 |

Before-GR and Consignment have the same two flags. Item Type=Consignment or the supplied category distinguishes them. Using only GR=true and IV=false selects 236,552 items and merges these processes. Before-GR permits goods-first, invoice-first or equal receipt times; it does not require invoice-first. An unusual trace remains in its configured category and can be assessed against a separate rule.

Independent full CSV scans confirm 1,595,923 events, 251,734 PO items and 76,349 purchasing documents. All sixteen case attributes are invariant within each item in this snapshot. There are 2,235 mixed-flow documents. Per-flow document memberships overlap and cannot be added as distinct documents. A document containing an after-GR item may also contain before-GR or Consignment items; including all its siblings creates a different population.

**Item Type is a separate dimension:** Standard, Service, Subcontracting, Third-party, Limit and Consignment. In the source, after-GR contains 8,344 Standard, 5,838 Service, 616 Subcontracting and 384 Third-party items. The 5,838 Service items account for 267,601 events, so event percentages must not replace item percentages. Document Type is another dimension with Standard PO, Framework order and EC Purchase order.

These meanings are described by the [official BPIC19 challenge](https://tfpm.compute.dtu.dk/competitions-awards/bpi-challenge/2019). The counts above are independently scanned local-source values, not estimates from that page or reproductions of filtered report populations.

## What can be done in the current source

The source contains a manual route when the category is mapped as context:

1. In **Data**, retain case Item Category under **Context attributes (optional)**. For the prepared CSV the field is **source__case Item Category**. Retain Item Type, both flags and the document/item fields as well.
2. In **Investigations → Filters → Context values**, select that category column and one exact category value, then **Keep by context**. This selects whole PO-item histories. The independently verified attribute invariance makes this route meaningful for the supplied snapshot.
3. A further Item Type predicate refines the selection; values within one predicate use OR and successive predicates use AND. Undo retains the earlier parent. The existing comparison and save routes are foundations for retaining the result.

The current source also offers **Groups → Same [context column]**. That operation groups any-record shared values, can overlap when values change within a case and suppresses nonmissing groups below its minimum support. It is not a verified disjoint business-type classifier. First-record context is also a named record anchor, not proof that a field is an invariant case attribute.

If category was not retained in the mapping, this filter cannot expose it merely because it exists in the source file. The prepared catalogue retains all original attributes, including the category and cross-check fields; the missing explicit journey is not a lack of category data.

The route above was read from the current implementation. It does not certify the installed application's build, the four-flow experience or full-size browser usability.

## Reconstructed analyst pipeline and actual gaps

The fifteen reports do not use one identical cleaning or completion policy. This sequence preserves the decisions they make instead of imposing a common result.

| Step | What the analyst actually does | Existing WISE foundation | Missing complete behavior |
|---|---|---|---|
| 1. Understand the question and grain | Identify purchase-to-pay; distinguish event, PO item, purchasing document and inferred invoice episode; identify the three challenge questions | CSV role mapping and original-case evidence | Reviewed business roles, document-item consistency, multiple-grain support and question-specific source recipe |
| 2. Profile the whole source | Inspect all fields, distinct values, missingness, repeated case attributes, event counts, timestamps and document membership | Import parse/time/order reports, original rows and some opening-context distributions | Whole-source case-attribute profiling, invariant/conflicting reducers and item/event/document denominators |
| 3. Separate the four purchasing flows | Use Item Category, cross-check flags and Item Type, review unknown/conflicting items, retain the original universe | Manual context filters and shared-value groups | A counted four-flow overview, inspectable classification definition, unresolved support, full-history selection and durable membership |
| 4. Subdivide heterogeneous flows | Compare Standard/Service, EC/non-EC, SRM participation, requisition presence and repeated cycles within a flow | Successive predicates and two-group comparison | Bounded flow-by-Item-Type table; named subgroup investigations with visible parents; separately admitted activity projections |
| 5. Declare the analysed population | Choose whole-item/document period policy, observation horizon, source exclusions and recorded completion; review before/after counts | Whole-case selection, period predicates, history and save | Per-flow inclusion/completion recipes, trusted horizon versus anomalous raw dates and explicit retained/excluded/unknown support |
| 6. Establish event meaning | Distinguish vendor invoice from recorded invoice, GR from SES, cancellations, edits and legitimate repeated deliveries; review ties and actor attribution | Original labels/records, exact sequences and source ordering policies | Reviewed selector dictionary and qualified count/resource/receipt/cancellation definitions with witness sets |
| 7. Choose value and interval definitions | Compare creation value, event sums or historical maximum-absolute proxy; declare independent minima, ordinal, FIFO or close-delimited matching | Raw amounts/time and recorded span/gap foundations | Source-witnessed value reducers; named occurrence matching; endpoint/zero/unmatched states; exact-formula gate for approximations |
| 8. Explore each retained process | Inspect its actual map/variants and, where needed, discover a finite model; retain projected versus original events | Observed maps, exact repeated variants and full histories | Analytical projection lineage and separately qualified discovery engines; a DFG is not a discovered/reference model |
| 9. Check and compare | Apply source-specific precedence/presence/value rules, evaluate reviewed-model conformance, compare flows/subtypes/vendors and timing distributions | Basic selection/comparison and one Resolution timing expectation | Occurrence-quantified rules, multiple supported measures/criteria, reviewed flow-dependent scope and finite alignment/financial operators |
| 10. Optionally apply WISE | Load the actual paper ten-criterion profile or the distinct historical twenty-nine-criterion profile; evaluate availability, views, PI and signed explanations | Method numerical families are present; the application has a one-criterion adapter | Domain bindings, criterion-local availability, multi-criterion authoring, correct coverage, group priorities, sensitivity and raw-source drivers |
| 11. Challenge and retain findings | Open witnesses/counterexamples; keep assumptions and discrepancies; export and repeat the pipeline | Immutable investigation persistence and complete-case inspection | Frozen measure/profile/action/output manifests and independently qualified replay/full-workload behavior |
| 12. Develop improvements | Form hypotheses, qualify scenarios or prediction, record adoption and balancing evidence | Related existing backlog ownership | Finite source-specific extensions; no source proves achieved savings or causal benefit |

Steps 1–5 are essential analyst tasks in their own right. A score does not supply them, and they must work without a Norm. In particular, the paper keeps **all 251,734 items**, including histories without clearing. A reviewed **no completion exclusion** policy is valid. Filtering to completed items before that assessment would remove the cases needed for its missing-clearing criterion.

Consignment does not require item invoice/clearing; two-way does not require GR. Service SES/GR repetition can be legitimate. The paper's C03 is scoped only to the two three-way flows, despite Consignment's business recipe including GR. Report rules and paper screening scopes are separate named definitions.

The abbreviation PR must also remain explicit: source spend classification PR means product-related, while report14's PR split uses Purchase Requisition activity. They are different predicates.

## Revised delivery order

The [full specification](bpic19-analysis-pipeline.md) now has 104 user stories. The [numbered breakdown](../ticket-proposals/bpic19-analysis-pipeline/breakdown.md) has 27 approved, published slices with explicit blockers. The new beginning is:

1. **Review source and observation policy** — no new blocker; save the source interpretation.
2. **Profile case attributes and business grain** — no new blocker; expose invariance, values, identity and mixed-document support.
3. **Distinguish four purchasing flow types** — blocked by 02; review and select the exact four whole-item populations.
4. **Compare flow and item-type subgroups** — blocked by 03; expose the cross-tab and retained comparison parents.
5. **Inspect activity measures** — no new blocker; retain exact count/presence witnesses.
6. **Review flow-specific completion/inclusion cohorts** — blocked by 01,03,05; retain the population decisions before later results.

Norm admission consumes the reviewed flow partition. Full paper qualification includes this first journey, the complete ten-criterion profile, named comparisons, export and actual process restart. Financial exposure, the historical profile and other report-method extensions qualify separately. Related open issues are reused only where their implemented scope actually supplies the required behavior; source-specific discovery/clustering/actor/regression methods have explicit finite amendment or activation gates.

## Acceptance seam

Proposed owner-review seam: real local HTTP → matching built browser on the same host → inspect exact full-history membership → export/save → actual process stop/restart → reopen. Independent fixtures include all four categories, the identical before-GR/Consignment flags, configured after-GR with observed invoice-first, a mixed-flow document, unknown/changing categories, Standard/Service subgroups and retained missing-clearing items. Literal IDs/counts/availability/witnesses must reconcile before matching numerical literature outputs.

The source scans and document review establish these requirements and acceptance totals. They do not constitute implementation or an executed full analyst pipeline.
