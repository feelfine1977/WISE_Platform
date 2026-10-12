# Optional local goal authoring

**Status:** selected boundary; authoring and integration pending.

**Problem:** business intent needs operational definitions, but exploration must work before a rule exists.

**Decision:** local goal authoring and bindings live in the application workflow. They produce versioned draft/reviewed definitions with scope, endpoints, clock, target, missingness and provenance. Method alone validates/evaluates supported norms. Knowledge/templates are reviewed inputs. Optional later assistance proposes definitions; a human reviews them.

Authoring is separate from projecting actual score results and witnesses to a Flow scene. The latter uses real run identity and coverage. Example marks cannot stand in for scores from the loaded log.

**Alternatives:** requiring a separate authoring server or dummy norm for every investigation is rejected. A second preview scorer with different semantics is rejected. Automatic approval or silent definition changes are rejected.

**Consequences:** the first complete release includes incident expectations while keeping them optional in the workflow. Prior authoring ideas/tests may inform improved implementation; whole repositories or runtime adapters need not be transplanted.

**Required review fields:** compile scope into Method's supported norm grammar; read applicability from actual results. Expose target/width, missing-response policy and pairing choices. Preserve scored-population/calibration identity when showing a selected subset; explicit rescoring creates a new run.
