from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict


@dataclass
class Sample:
    ts: float
    ok: bool
    latency_ms: int
    endpoint: str
    status_code: int
    error: str | None = None


def _request_json(url: str, timeout: float) -> tuple[bool, int, int, str | None]:
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            _ = response.read()
            latency = int((time.perf_counter() - started) * 1000)
            return True, response.getcode(), latency, None
    except urllib.error.HTTPError as exc:
        latency = int((time.perf_counter() - started) * 1000)
        return False, exc.code, latency, str(exc)
    except Exception as exc:  # pragma: no cover
        latency = int((time.perf_counter() - started) * 1000)
        return False, 0, latency, str(exc)


def run(base_url: str, duration_seconds: int, interval_seconds: float, timeout: float) -> dict[str, object]:
    endpoints = ["/api/v1/health", "/api/v1/runs/stats", "/api/v1/runs/alerts"]
    samples: list[Sample] = []
    deadline = time.time() + duration_seconds
    while time.time() < deadline:
        for endpoint in endpoints:
            ok, status_code, latency, error = _request_json(f"{base_url}{endpoint}", timeout=timeout)
            samples.append(
                Sample(
                    ts=time.time(),
                    ok=ok,
                    latency_ms=latency,
                    endpoint=endpoint,
                    status_code=status_code,
                    error=error,
                )
            )
        time.sleep(interval_seconds)

    total = len(samples)
    failures = [item for item in samples if not item.ok]
    latencies = sorted(item.latency_ms for item in samples)
    p95 = latencies[min(int(len(latencies) * 0.95), len(latencies) - 1)] if latencies else 0
    return {
        "baseUrl": base_url,
        "durationSeconds": duration_seconds,
        "samples": total,
        "failureCount": len(failures),
        "p95LatencyMs": p95,
        "failureRate": round(len(failures) / total, 6) if total else 0,
        "last10Failures": [asdict(item) for item in failures[-10:]],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="RPA Flow API 长稳探测脚本")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--duration-seconds", type=int, default=300)
    parser.add_argument("--interval-seconds", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=3.0)
    args = parser.parse_args()

    result = run(
        base_url=args.base_url,
        duration_seconds=args.duration_seconds,
        interval_seconds=args.interval_seconds,
        timeout=args.timeout,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
