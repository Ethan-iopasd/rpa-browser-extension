from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request


def check_endpoint(url: str, timeout: float) -> dict[str, object]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return {"url": url, "ok": response.getcode() < 400, "status": response.getcode()}
    except urllib.error.HTTPError as exc:
        return {"url": url, "ok": False, "status": exc.code, "error": str(exc)}
    except Exception as exc:  # pragma: no cover
        return {"url": url, "ok": False, "status": 0, "error": str(exc)}


def run(base_url: str, timeout: float) -> dict[str, object]:
    urls = [
        f"{base_url}/api/v1/health",
        f"{base_url}/api/v1/runs/stats",
        f"{base_url}/api/v1/runs/alerts",
        f"{base_url}/api/v1/tasks",
        f"{base_url}/api/v1/security/credentials",
        f"{base_url}/api/v1/security/audit",
    ]
    results = [check_endpoint(url, timeout) for url in urls]
    success = all(bool(item["ok"]) for item in results)
    return {"success": success, "checks": results}


def main() -> None:
    parser = argparse.ArgumentParser(description="RPA Flow 发布回归门禁")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--timeout", type=float, default=3.0)
    args = parser.parse_args()
    result = run(base_url=args.base_url, timeout=args.timeout)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result["success"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
