# Local application composition

**Status:** selected for the first build.

**Problem:** a complete visual investigation needs one maintainable application home and coherent behavior on Windows.

**Decision:** one application monorepo with Python/FastAPI, TypeScript/React and JSON Schema boundaries. One Python process serves the API and built frontend for the analyst. Node is used for development/build. Add a pure descriptive analytics package with its first tested responsibility. Method and Flow remain qualified exact external libraries.

**Alternatives:** a wrapper around sibling working checkouts would preserve incidental paths and version ambiguity; importing all source histories would mix product ownership and maintenance; a microservice per module would add deployment requirements before useful local analysis. A desktop executable remains optional packaging later.

**Consequences:** the roadmap leads fresh composition. Reuse is optional and tested, not a requirement to preserve old workspace formats. Earned folders keep the tree small. Early Windows checks run the foundation; the actual human incident journey is a separate release gate.
