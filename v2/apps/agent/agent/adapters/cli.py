from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, cast

from agent.models.contracts import RunOptions
from agent.runtime.engine import run_flow


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="RPA Flow agent runtime")
    parser.add_argument("--flow", required=True, help="Path to flow JSON")
    parser.add_argument("--max-steps", type=int, default=1000, help="Max node execution steps")
    parser.add_argument("--default-timeout-ms", type=int, default=5000, help="Default node timeout")
    parser.add_argument("--default-max-retries", type=int, default=0, help="Default node retries")
    parser.add_argument(
        "--browser-mode",
        choices=["auto", "real", "simulate"],
        default="auto",
        help="Browser runtime mode: auto(real when playwright available), real(force real), simulate(stub)",
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Run browser in headed mode when real browser runtime is enabled.",
    )
    return parser.parse_args()


def load_flow(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"Flow file not found: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    return cast(dict[str, Any], payload)


def run_cli() -> None:
    args = parse_args()
    flow_path = Path(args.flow)
    flow = load_flow(flow_path)
    variables = flow.get("variables")
    if not isinstance(variables, dict):
        variables = {}
        flow["variables"] = variables
    variables["_browserMode"] = args.browser_mode
    if args.headed:
        variables["_browserHeadless"] = False
    result = run_flow(
        flow=flow,
        options=RunOptions(
            maxSteps=args.max_steps,
            defaultTimeoutMs=args.default_timeout_ms,
            defaultMaxRetries=args.default_max_retries,
        ),
    )
    print(json.dumps(result.model_dump(), ensure_ascii=False, indent=2))
