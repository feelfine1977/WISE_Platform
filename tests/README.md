# Foundation tests and pending analysis acceptance

The test groups qualify different responsibilities:

- `test_health_contract.py` checks the source health schema, generated Python model and actual local API/static-file behavior. It makes no analysis readiness claim.
- `test_local_host.py` starts the real CLI on a loopback port, checks local HTTP/assets, stops its owned process, and restarts. It does not establish saved-investigation persistence.
- `contracts/health-types.test.ts` checks generated TypeScript constants, required fields and closed payloads. The runtime version pattern is checked by JSON Schema/Python, rather than inferred from TypeScript's string type.
- `test_synthetic_fixtures.py` checks the fictional inputs and hand-checkable expectations with the independent test reference. Passing this group establishes fixture consistency and policy-ID registry shape, not companion correctness. The registry does not certify a product parser or supported policies.
- `test_analytics_acceptance.py` is **pending** until an actual companion adapter is supplied. Skips are not successful analysis acceptance. The adapter must invoke real product code; it must not return golden answers or run `fixture_reference.py` as the application.

Qualification of health/schema/build, synthetic reference arithmetic and actual companion behavior should be reported separately. No company data is included. Browser linked-state behavior, strict threshold boundary, conflicting timestamp/order policy, Windows locking/restart and capacity still need their own receipts.

The pending acceptance adapter receives named machine-readable IDs from `fixtures/incidents/policy_ids.json`. Text in `expected.json` describes the examples for readers; it must never be parsed as a policy language. The first analytical slice must define typed policy forms and explicit refusal of unsupported IDs. Current registry sanity checks do not establish those behaviors.
