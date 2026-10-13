"""Serve the local API and the built browser application."""

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .boundary import read_object
from .examples import PACKAGED_EXAMPLES
from .generated.health import HealthResponse
from .imports import ImportReply, Imports
from .investigations import Investigations, Reply
from .selections import SelectionReply, Selections
from .workspace import program_folders


def create_app(static_dir: Path | None = None, examples_dir: Path | None = None) -> FastAPI:
    """Build the application; ``examples_dir`` replaces the packaged synthetic examples.

    Workspaces are refused inside the program's own folders, so that nothing is written there.
    """
    application = FastAPI(title="WISE Platform", version=__version__)
    investigations = Investigations(
        examples_dir if examples_dir is not None else PACKAGED_EXAMPLES
    )
    imports = Imports(forbidden=program_folders())
    selections = Selections(imports)

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

    @application.post("/api/workspaces/open")
    async def open_workspace(request: Request) -> JSONResponse:
        return _sent_import(await run_in_threadpool(imports.open_workspace, await request.body()))

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

    @application.post("/api/investigations/open-population")
    async def open_population(request: Request) -> JSONResponse:
        return _sent_import(await run_in_threadpool(imports.open_population, await request.body()))

    @application.post("/api/investigations/select-cases")
    async def select_cases(request: Request) -> JSONResponse:
        return _sent_selection(await run_in_threadpool(selections.select_cases, await request.body()))

    @application.post("/api/investigations/process-graph")
    async def process_graph(request: Request) -> JSONResponse:
        return _sent_selection(await run_in_threadpool(selections.process_graph, await request.body()))

    @application.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def unknown_api(path: str) -> None:
        raise HTTPException(status_code=404, detail="API route not found")

    assets = static_dir if static_dir is not None else Path(__file__).parent / "static"
    if (assets / "index.html").is_file():
        application.mount("/", StaticFiles(directory=assets, html=True), name="browser")
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


def _message_type(body: bytes) -> object:
    """The message type a request body names, if it is a JSON object."""
    message = read_object(body)
    return None if isinstance(message, str) else message.get("message_type")
