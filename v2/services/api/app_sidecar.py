from __future__ import annotations

import argparse
import os

import uvicorn

# Ensure PyInstaller collects agent runtime modules loaded via importlib.
import agent.models.contracts  # noqa: F401
import agent.runtime.engine  # noqa: F401
import agent.runtime.picker  # noqa: F401
import app.native_host  # noqa: F401
from app.main import app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="RPA Flow API sidecar")
    parser.add_argument("--host", default=os.getenv("RPA_API_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("RPA_API_PORT", "8000")))
    parser.add_argument("--log-level", default=os.getenv("RPA_API_LOG_LEVEL", "info"))
    parser.add_argument(
        "--native-messaging",
        action="store_true",
        help="Run as Chrome/Edge Native Messaging host on stdio.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.native_messaging:
        from app.native_host import run_native_host_loop

        run_native_host_loop()
        return
    uvicorn.run(app, host=args.host, port=args.port, log_level=args.log_level)


if __name__ == "__main__":
    main()
