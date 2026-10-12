"""Serve the local API and the built browser application."""

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .examples import PACKAGED_EXAMPLES
from .generated.health import HealthResponse
from .investigations import Investigations, Reply


def create_app(static_dir: Path | None = None, examples_dir: Path | None = None) -> FastAPI:
    """Build the application; ``examples_dir`` replaces the packaged synthetic examples."""
    application = FastAPI(title="WISE Platform", version=__version__)
    investigations = Investigations(
        examples_dir if examples_dir is not None else PACKAGED_EXAMPLES
    )

    @application.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok", stage="foundation", version=__version__)

    @application.post("/api/investigations/open-example")
    async def open_example(request: Request) -> JSONResponse:
        return _sent(await run_in_threadpool(investigations.open_example, await request.body()))

    @application.post("/api/investigations/case-evidence")
    async def case_evidence(request: Request) -> JSONResponse:
        return _sent(await run_in_threadpool(investigations.case_evidence, await request.body()))

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
