"""Start the local application."""

import argparse
from pathlib import Path

import uvicorn

from .app import create_app


def main() -> None:
    parser = argparse.ArgumentParser(description="Start WISE Platform on this computer.")
    parser.add_argument("--host", choices=("127.0.0.1", "localhost"), default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--workspace", type=Path,
        help="Use this local workspace instead of the per-user default; initialized when the browser opens it.",
    )
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    uvicorn.run(create_app(workspace_path=args.workspace), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
