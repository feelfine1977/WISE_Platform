"""Serve the local API and the built browser application."""

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__
from .boundary import read_object
from .bpic19_profiles import Bpic19Profiles
from .bpic19_cohorts import register_bpic19_cohort_routes
from .bpic19_scoring import register_bpic19_scoring_routes
from .bpic19_operators import register_bpic19_operator_routes
from .bpic19_flow_comparison import register_bpic19_flow_comparison_routes
from .bpic19_interval_comparison import register_bpic19_interval_comparison_routes
from .bpic19_measures import Bpic19Measures
from .case_lists import CaseLists
from .comparisons import ComparisonReply, Comparisons
from .examples import CATALOG, PACKAGED_EXAMPLES, read_example
from .expectations import Expectations, ScoringReply
from .generated.health import HealthResponse
from .imports import ImportReply, Imports
from .investigations import Investigations, Reply
from .population_views import PopulationViews, ViewReply
from .rule_groups import RuleGroups
from .saving import Saving, SavingReply
from .selections import SelectionReply, Selections
from .start_trends import StartTrends
from .workspace import program_folders


class _BrowserFiles(StaticFiles):
    """The built browser files.

    The page itself is asked for anew on every visit, so that a newer installation is shown and not
    the page a browser kept from an earlier one. The files it names carry their content in their
    names and may be kept.
    """

    async def get_response(self, path, scope):  # type: ignore[no-untyped-def]
        response = await super().get_response(path, scope)
        if response.headers.get("content-type", "").startswith("text/html"):
            response.headers["Cache-Control"] = "no-cache"
        return response


def create_app(
    static_dir: Path | None = None, examples_dir: Path | None = None, *, workspace_path: Path | None = None
) -> FastAPI:
    """Build the application; ``examples_dir`` replaces the packaged synthetic examples.

    Workspaces are refused inside the program's own folders, so that nothing is written there.
    The selections made are held in ``application.state.selections``.
    """
    application = FastAPI(title="WISE Platform", version=__version__)
    examples = examples_dir if examples_dir is not None else PACKAGED_EXAMPLES
    investigations = Investigations(examples)
    imports = Imports(forbidden=program_folders(), workspace_path=workspace_path)
    selections = Selections(imports)
    views = PopulationViews(imports)
    case_lists = CaseLists(imports)
    start_trends = StartTrends(imports)
    rule_group_views = RuleGroups(imports)
    comparisons = Comparisons(imports)
    expectations = Expectations(imports)
    bpic19_profiles = Bpic19Profiles(imports)
    bpic19_measures = Bpic19Measures(imports)
    register_bpic19_cohort_routes(application, imports)
    register_bpic19_scoring_routes(application, imports)
    register_bpic19_operator_routes(application, imports)
    register_bpic19_flow_comparison_routes(application, imports)
    register_bpic19_interval_comparison_routes(application, imports)
    saving = Saving(imports)
    application.state.selections = imports.selections

    @application.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok", stage="foundation", version=__version__)

    @application.post("/api/investigations/open-example")
    async def open_example(request: Request) -> JSONResponse:
        return _sent(await run_in_threadpool(investigations.open_example, await request.body()))

    @application.post("/api/investigations/case-evidence")
    async def case_evidence(request: Request) -> JSONResponse:
        body = await request.body()
        if _message_type(body) == "imported_case_evidence_request":
            return _sent_import(await run_in_threadpool(imports.case_evidence, body))
        return _sent(await run_in_threadpool(investigations.case_evidence, body))

    @application.get("/api/examples/{example_id}/source")
    def example_source(example_id: str) -> Response:
        """The unchanged bytes of a packaged example, to be stored in a workspace like any CSV."""
        if example_id not in CATALOG:
            raise HTTPException(status_code=404, detail="The application ships no example of this name.")
        raw = read_example(examples, example_id)
        if raw is None:
            raise HTTPException(
                status_code=503,
                detail=f"The bytes of example {example_id} cannot be read. Reinstall the application.",
            )
        return Response(raw, media_type="text/csv; charset=utf-8")

    @application.post("/api/workspaces/open")
    async def open_workspace(request: Request) -> JSONResponse:
        return _sent_import(await run_in_threadpool(imports.open_workspace, await request.body()))

    @application.post("/api/workspaces/open-default")
    async def open_default_workspace(request: Request) -> JSONResponse:
        return _sent_import(await run_in_threadpool(imports.open_default_workspace, await request.body()))

    @application.put("/api/sources")
    async def upload_source(request: Request) -> JSONResponse:
        raw = await request.body()
        return _sent_import(
            await run_in_threadpool(
                imports.upload_source,
                request.query_params.multi_items(),
                request.headers.get("content-type"),
                raw,
            )
        )

    @application.post("/api/sources/inspect")
    async def inspect_source(request: Request) -> JSONResponse:
        return _sent_import(await run_in_threadpool(imports.inspect, await request.body()))

    @application.post("/api/preparations")
    async def confirm_mapping(request: Request) -> JSONResponse:
        return _sent_import(await run_in_threadpool(imports.confirm_mapping, await request.body()))

    @application.post("/api/preparations/cutoff-proposal")
    async def propose_cutoff(request: Request) -> JSONResponse:
        return _sent_import(await run_in_threadpool(imports.propose_cutoff, await request.body()))

    @application.post("/api/investigations/open-population")
    async def open_population(request: Request) -> JSONResponse:
        return _sent_import(await run_in_threadpool(imports.open_population, await request.body()))

    @application.post("/api/investigations/select-cases")
    async def select_cases(request: Request) -> JSONResponse:
        return _sent_selection(await run_in_threadpool(selections.select_cases, await request.body()))

    @application.post("/api/investigations/process-graph")
    async def process_graph(request: Request) -> JSONResponse:
        return _sent_selection(await run_in_threadpool(selections.process_graph, await request.body()))

    @application.post("/api/investigations/bpic19-profile")
    async def bpic19_profile(request: Request) -> JSONResponse:
        reply = await run_in_threadpool(bpic19_profiles.profile, await request.body())
        return JSONResponse(reply.body, status_code=reply.status)

    @application.post("/api/investigations/bpic19-measures")
    async def bpic19_measure(request: Request) -> JSONResponse:
        reply = await run_in_threadpool(bpic19_measures.measures, await request.body())
        return JSONResponse(reply.body, status_code=reply.status)

    @application.post("/api/investigations/case-list")
    async def case_list(request: Request) -> JSONResponse:
        reply = await run_in_threadpool(case_lists.case_list, await request.body())
        return JSONResponse(reply.body, status_code=reply.status)

    @application.post("/api/investigations/start-trend")
    async def start_trend(request: Request) -> JSONResponse:
        reply = await run_in_threadpool(start_trends.start_trend, await request.body())
        return JSONResponse(reply.body, status_code=reply.status)

    @application.post("/api/investigations/opening-context")
    async def opening_context(request: Request) -> JSONResponse:
        return _sent_view(await run_in_threadpool(views.opening_context, await request.body()))

    @application.post("/api/investigations/rule-groups")
    async def rule_groups(request: Request) -> JSONResponse:
        reply = await run_in_threadpool(rule_group_views.rule_groups, await request.body())
        return JSONResponse(reply.body, status_code=reply.status)

    @application.post("/api/investigations/variants")
    async def variants(request: Request) -> JSONResponse:
        return _sent_view(await run_in_threadpool(views.variants, await request.body()))

    @application.post("/api/investigations/compare-groups")
    async def compare_groups(request: Request) -> JSONResponse:
        return _sent_comparison(await run_in_threadpool(comparisons.compare_groups, await request.body()))

    @application.post("/api/investigations/compare-periods")
    async def compare_periods(request: Request) -> JSONResponse:
        return _sent_comparison(await run_in_threadpool(comparisons.compare_periods, await request.body()))

    @application.post("/api/expectations/validate")
    async def validate_expectation(request: Request) -> JSONResponse:
        return _sent_scoring(await run_in_threadpool(expectations.validate, await request.body()))

    @application.post("/api/expectations/score")
    async def score_expectation(request: Request) -> JSONResponse:
        return _sent_scoring(await run_in_threadpool(expectations.score, await request.body()))

    @application.post("/api/expectations/case-witness")
    async def score_case_witness(request: Request) -> JSONResponse:
        return _sent_scoring(await run_in_threadpool(expectations.case_witness, await request.body()))

    @application.post("/api/expectations/read-run")
    async def read_score_run(request: Request) -> JSONResponse:
        return _sent_scoring(await run_in_threadpool(expectations.read_run, await request.body()))

    @application.post("/api/investigations/save")
    async def save_investigation(request: Request) -> JSONResponse:
        return _sent_saving(await run_in_threadpool(saving.save, await request.body()))

    @application.post("/api/investigations/list-saved")
    async def list_saved(request: Request) -> JSONResponse:
        return _sent_saving(await run_in_threadpool(saving.list_saved, await request.body()))

    @application.post("/api/investigations/reopen")
    async def reopen_investigation(request: Request) -> JSONResponse:
        return _sent_saving(await run_in_threadpool(saving.reopen, await request.body()))

    @application.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def unknown_api(path: str) -> None:
        raise HTTPException(status_code=404, detail="API route not found")

    assets = static_dir if static_dir is not None else Path(__file__).parent / "static"
    if (assets / "index.html").is_file():
        application.mount("/", _BrowserFiles(directory=assets, html=True), name="browser")
    else:
        @application.get("/", response_class=PlainTextResponse, status_code=503)
        def browser_unavailable() -> str:
            return (
                "WISE Platform browser assets are not built. "
                "For a source checkout, install development dependencies, then run "
                "npm run generate and npm run build. The local API is available at /api/health."
            )

    return application


def _sent(reply: Reply) -> JSONResponse:
    return JSONResponse(reply.body.model_dump(mode="json"), status_code=reply.status)


def _sent_import(reply: ImportReply) -> JSONResponse:
    return JSONResponse(reply.body, status_code=reply.status)


def _sent_selection(reply: SelectionReply) -> JSONResponse:
    return JSONResponse(reply.body, status_code=reply.status)


def _sent_view(reply: ViewReply) -> JSONResponse:
    return JSONResponse(reply.body, status_code=reply.status)


def _sent_comparison(reply: ComparisonReply) -> JSONResponse:
    return JSONResponse(reply.body, status_code=reply.status)


def _sent_scoring(reply: ScoringReply) -> JSONResponse:
    return JSONResponse(reply.body, status_code=reply.status)


def _sent_saving(reply: SavingReply) -> JSONResponse:
    return JSONResponse(reply.body, status_code=reply.status)


def _message_type(body: bytes) -> object:
    """The message type a request body names, if it is a JSON object."""
    message = read_object(body)
    return None if isinstance(message, str) else message.get("message_type")
