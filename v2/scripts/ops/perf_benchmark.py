from __future__ import annotations

import argparse
import json
import statistics
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FLOW_PATH = ROOT / "packages" / "flow-schema" / "examples" / "minimal.flow.json"


def _post_json(url: str, payload: dict[str, object], timeout: float) -> tuple[int, int]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url=url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=timeout) as response:
        _ = response.read()
        latency = int((time.perf_counter() - started) * 1000)
        return response.getcode(), latency


def run(base_url: str, rounds: int, timeout: float) -> dict[str, object]:
    flow = json.loads(FLOW_PATH.read_text(encoding="utf-8"))
    payload = {"flow": flow}
    latencies: list[int] = []
    failures = 0
    for _ in range(rounds):
        try:
            status_code, latency = _post_json(f"{base_url}/api/v1/runs", payload, timeout)
            if status_code >= 400:
                failures += 1
            latencies.append(latency)
        except Exception:
            failures += 1
    latencies.sort()
    p95 = latencies[min(int(len(latencies) * 0.95), len(latencies) - 1)] if latencies else 0
    return {
        "rounds": rounds,
        "failures": failures,
        "successRate": round((rounds - failures) / rounds, 6) if rounds else 0,
        "avgLatencyMs": int(statistics.mean(latencies)) if latencies else 0,
        "p95LatencyMs": p95,
        "maxLatencyMs": max(latencies) if latencies else 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="RPA Flow API 压测脚本")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--rounds", type=int, default=100)
    parser.add_argument("--timeout", type=float, default=5.0)
    args = parser.parse_args()
    result = run(base_url=args.base_url, rounds=args.rounds, timeout=args.timeout)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
