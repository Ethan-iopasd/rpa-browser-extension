from __future__ import annotations

import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_KATALON_TIMEOUT_MS = 10 * 60 * 1000
MAX_LOG_CHARS = 12_000


@dataclass(slots=True)
class KatalonRunError(Exception):
    message: str
    details: dict[str, Any]

    def __str__(self) -> str:
        return self.message


def _string(value: Any) -> str | None:
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed or None
    return None


def _int(value: Any, default: int) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.lstrip("-").isdigit():
            return int(stripped)
    return default


def _bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
    return default


def _list_of_strings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            result.append(item.strip())
    return result


def _tail(text: str, max_chars: int = MAX_LOG_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    return text[-max_chars:]


def _resolve_command(config: dict[str, Any]) -> str:
    return (
        _string(config.get("command"))
        or _string(os.getenv("RPA_KATALON_COMMAND"))
        or "katalonc"
    )


def _resolve_project_path(config: dict[str, Any]) -> str:
    candidate = _string(config.get("projectPath")) or _string(config.get("project"))
    if not candidate:
        raise KatalonRunError(
            message="Katalon config missing project path.",
            details={"required": ["projectPath"], "receivedKeys": sorted(config.keys())},
        )
    project_path = str(Path(candidate).expanduser().resolve())
    if not Path(project_path).exists():
        raise KatalonRunError(
            message="Katalon project path not found.",
            details={"projectPath": project_path},
        )
    return project_path


def _normalize_katalon_config(config: dict[str, Any], timeout_ms: int | None) -> dict[str, Any]:
    project_path = _resolve_project_path(config)
    test_suite_path = _string(config.get("testSuitePath"))
    test_suite_collection_path = _string(config.get("testSuiteCollectionPath"))
    if not test_suite_path and not test_suite_collection_path:
        raise KatalonRunError(
            message="Katalon config requires testSuitePath or testSuiteCollectionPath.",
            details={"projectPath": project_path},
        )
    report_folder = _string(config.get("reportFolder")) or _string(config.get("reportFolderPath"))
    normalized = {
        "command": _resolve_command(config),
        "projectPath": project_path,
        "testSuitePath": test_suite_path,
        "testSuiteCollectionPath": test_suite_collection_path,
        "executionProfile": _string(config.get("executionProfile")),
        "browserType": _string(config.get("browserType")),
        "apiKey": _string(config.get("apiKey")),
        "retry": max(_int(config.get("retry"), 0), 0),
        "consoleLog": _bool(config.get("consoleLog"), True),
        "reportFolder": report_folder,
        "extraArgs": _list_of_strings(config.get("extraArgs")),
        "failOnNonZeroExit": _bool(config.get("failOnNonZeroExit"), True),
        "timeoutMs": max(_int(timeout_ms, _int(config.get("timeoutMs"), DEFAULT_KATALON_TIMEOUT_MS)), 1),
    }
    return normalized


def _build_katalon_command_from_normalized(normalized: dict[str, Any]) -> list[str]:
    command = [normalized["command"], f"-projectPath={normalized['projectPath']}"]
    if normalized["testSuitePath"]:
        command.append(f"-testSuitePath={normalized['testSuitePath']}")
    if normalized["testSuiteCollectionPath"]:
        command.append(f"-testSuiteCollectionPath={normalized['testSuiteCollectionPath']}")
    if normalized["executionProfile"]:
        command.append(f"-executionProfile={normalized['executionProfile']}")
    if normalized["browserType"]:
        command.append(f"-browserType={normalized['browserType']}")
    if normalized["apiKey"]:
        command.append(f"-apiKey={normalized['apiKey']}")
    if normalized["reportFolder"]:
        command.append(f"-reportFolder={normalized['reportFolder']}")
    if normalized["retry"] > 0:
        command.append(f"-retry={normalized['retry']}")
    if normalized["consoleLog"]:
        command.append("-consoleLog")
    command.extend(normalized["extraArgs"])
    return command


def build_katalon_command(config: dict[str, Any], timeout_ms: int | None = None) -> list[str]:
    normalized = _normalize_katalon_config(config, timeout_ms)
    return _build_katalon_command_from_normalized(normalized)


def run_katalon(config: dict[str, Any], timeout_ms: int | None = None) -> dict[str, Any]:
    normalized = _normalize_katalon_config(config, timeout_ms)
    command = _build_katalon_command_from_normalized(normalized)
    timeout_seconds = max(1.0, normalized["timeoutMs"] / 1000.0)
    started = time.perf_counter()
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
            cwd=normalized["projectPath"],
        )
    except FileNotFoundError as exc:
        raise KatalonRunError(
            message="Katalon command not found.",
            details={"command": command[0], "hint": "Set config.command or env RPA_KATALON_COMMAND."},
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise KatalonRunError(
            message="Katalon run timed out.",
            details={
                "timeoutMs": normalized["timeoutMs"],
                "command": command,
                "stdoutTail": _tail(exc.stdout or ""),
                "stderrTail": _tail(exc.stderr or ""),
            },
        ) from exc
    duration_ms = int((time.perf_counter() - started) * 1000)
    output = {
        "success": completed.returncode == 0,
        "exitCode": completed.returncode,
        "durationMs": duration_ms,
        "command": command,
        "projectPath": normalized["projectPath"],
        "testSuitePath": normalized["testSuitePath"],
        "testSuiteCollectionPath": normalized["testSuiteCollectionPath"],
        "reportFolder": normalized["reportFolder"],
        "stdoutTail": _tail(completed.stdout or ""),
        "stderrTail": _tail(completed.stderr or ""),
    }
    if completed.returncode != 0 and normalized["failOnNonZeroExit"]:
        raise KatalonRunError(
            message="Katalon run returned non-zero exit code.",
            details=output,
        )
    return output
