# Synthetic incident acceptance inputs

These four CSV files contain fictional incidents only. Empty activity/context cells are missing values; the literal string `Unknown` is a separate category. `expected.json` records hand-checkable memberships, units, policies, counts and exact rational measures.

- S0: twelve parent incidents plus two outside the parent, recorded-resolution partition, opening context including missing values, graph/variant membership and complete-case evidence.
- S1: one incident reopens and repeats a transition; distinct incident support, passages, mean and median differ.
- S2: missing activity labels remain in raw evidence but are omitted from mapped sequences; equal timestamps use sequence and original row position, without artificial ends.
- S3: a literal category named Unknown remains distinct from missing context.

The independent reference counter is test support, never application analytics. Its passing tests establish fixture consistency only. Population/evidence acceptance invokes the actual HTTP operations. Graph, profile, measured-query and score operations remain explicitly pending until their separate implementations; none may return these expected values or call the reference counter as a substitute for product logic.

The independent exact-four-hour input adds 3-hour, exactly 4-hour, 5-hour and missing-resolution histories. threshold_expected.json distinguishes strict >4 from inclusive >=4, with missing endpoints unevaluable. Fixture consistency is separate from product measured-query acceptance, which remains pending.

The current inputs do not qualify conflicting timestamp/sequence precedence, Windows locking/restart, browser selection behavior or production capacity. Those require separate implementation/release evidence. Health tests qualify only the foundation HTTP/schema behavior.
