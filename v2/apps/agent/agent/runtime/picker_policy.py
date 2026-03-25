from __future__ import annotations

import json
import os
from pathlib import Path
from threading import Lock
from typing import Any

DEFAULT_PICKER_SELECTOR_POLICY: dict[str, Any] = {
    "frame": {
        "selectorPriority": [
            "src_allowlist_query",
            "src_base",
            "nth_of_type",
            "name_stable",
            "id_stable",
            "name_dynamic",
            "id_dynamic",
        ],
        "dynamicIdentifierRegexes": [
            r"(auto-id|x-urs-iframe|mgid|timestamp|nonce|session|token|random|rand|traceid|guid|uuid)",
            r"\d{6,}",
            r"[a-f0-9]{12,}",
        ],
        # First-match-wins, inspired by Cypress attributeFilters behavior.
        "attributeFilters": [
            {
                "attribute": r"^(id|name)$",
                "value": r"(auto-id|x-urs-iframe|mgid|timestamp|nonce|session|token|random|rand|traceid|guid|uuid|\d{6,}|[a-f0-9]{12,})",
                "include": False,
            }
        ],
        "dynamicQueryKeys": [
            "mgid",
            "wdaid",
            "_",
            "t",
            "ts",
            "timestamp",
            "nonce",
            "token",
            "rand",
            "random",
            "traceid",
            "session",
            "sid",
            "pkid",
            "cd",
            "cf",
        ],
        "stableQueryAllowlist": ["product"],
        "maxQueryParams": 2,
        "maxParamValueLength": 64,
        "maxSrcFragmentLength": 180,
        "includeNthOfType": True,
        "allowDynamicNameWithoutSrc": True,
        "allowDynamicIdWithoutSrc": True,
        "scores": {
            "src_base": 0.95,
            "src_allowlist_query": 0.82,
            "nth_of_type": 0.72,
            "name_stable": 0.90,
            "name_dynamic": 0.20,
            "id_stable": 0.88,
            "id_dynamic": 0.18,
            "nth_fallback": 0.60,
        },
    }
}

_policy_lock = Lock()
_cached_policy: dict[str, Any] | None = None


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = dict(base)
    for key, value in override.items():
        existing = result.get(key)
        if isinstance(existing, dict) and isinstance(value, dict):
            result[key] = _deep_merge(existing, value)
        else:
            result[key] = value
    return result


def _load_json_file(path_value: str) -> dict[str, Any] | None:
    candidate = Path(path_value).expanduser()
    try:
        raw = candidate.read_text(encoding="utf-8")
    except Exception:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _load_json_inline(raw: str) -> dict[str, Any] | None:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def get_picker_selector_policy() -> dict[str, Any]:
    global _cached_policy
    with _policy_lock:
        if _cached_policy is not None:
            return _cached_policy

        policy = dict(DEFAULT_PICKER_SELECTOR_POLICY)

        file_path = os.getenv("RPA_PICKER_SELECTOR_POLICY_PATH", "").strip()
        if file_path:
            override_from_file = _load_json_file(file_path)
            if override_from_file:
                policy = _deep_merge(policy, override_from_file)

        inline_raw = os.getenv("RPA_PICKER_SELECTOR_POLICY_JSON", "").strip()
        if inline_raw:
            override_inline = _load_json_inline(inline_raw)
            if override_inline:
                policy = _deep_merge(policy, override_inline)

        _cached_policy = policy
        return _cached_policy
