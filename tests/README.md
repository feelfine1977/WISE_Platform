# Foundation tests and pending analysis acceptance

The test groups qualify different responsibilities:

- `test_health_contract.py` checks the source health schema, generated Python model and actual local API/static-file behavior. It makes no analysis readiness claim.
- `test_local_host.py` starts the real CLI on a loopback port, checks local HTTP/assets, stops its owned process, and restarts. It does not establish saved-investigation persistence.
- `contracts/health-types.test.ts` checks generated TypeScript constants, required fields and closed payloads. The runtime version pattern is checked by JSON Schema/Python, rather than inferred from TypeScript's string type.
- `test_synthetic_fixtures.py` checks the fictional inputs and hand-checkable expectations with the independent test reference. Passing this group establishes fixture consistency and policy-ID registry shape, not companion correctness. The registry does not certify a product parser or supported policies.
- `test_analytics_acceptance.py` exercises real population and complete-evidence HTTP operations against exact synthetic memberships, source rows, identities and typed refusals. Graph/profile/measured-query/score checks remain explicitly pending until their own operations exist. Skips never qualify analytics. Product logic must not return golden answers or run `fixture_reference.py` as the application.
- `test_investigation_contract.py` checks the closed source schema and generated request boundary; actual API tests separately qualify semantic refusals and avoid relying on model coercion.
- `test_import_acceptance.py` exercises actual local workspace/source/inspection/mapping/population/evidence operations with byte-preserved fictional CSV inputs, strict refusals and a fresh app instance. Tests fail until those operations exist; fixture consistency and schema checks do not substitute for these operations.
- `test_import_contract.py` checks the generated import boundary and explicit wall-clock versus UTC record forms.
- `test_selection_acceptance.py` exercises real complete-case selection, frozen parents, independent chip supports, explicit unevaluable groups, guarded selected evidence and supplied graphs through HTTP. The graph's raw-boundary and clock policies are explicit; its consumer compatibility is qualified separately against the pinned renderer.
- `test_selection_contract.py` checks descriptive intents and coupled graph clock domains, separately from actual query behavior.
- `test_threshold_fixture.py` verifies the independent 3-hour/exactly-4-hour/5-hour/missing endpoint inputs and strict/inclusive expectations. It establishes fixture consistency only, not a measured product operation.

Qualification of health/schema/build, synthetic reference arithmetic and actual companion behavior should be reported separately. No company data is included. Browser linked-state behavior, real measured threshold operation, conflicting timestamp/order policy, Windows locking/restart and capacity still need their own receipts.

The pending acceptance adapter receives named machine-readable IDs from `fixtures/incidents/policy_ids.json`. Text in `expected.json` describes the examples for readers; it must never be parsed as a policy language. The first analytical slice must define typed policy forms and explicit refusal of unsupported IDs. Current registry sanity checks do not establish those behaviors.
