"""Serve the local API and the built browser application."""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .generated.health import HealthResponse


def create_app(static_dir: Path | None = None) -> FastAPI:
    application = FastAPI(title="WISE Platform", version=__version__)

    @application.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok", stage="foundation", version=__version__)

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
