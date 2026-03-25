from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from app.core.config import settings
from app.repositories.json_store import JsonStore
from app.schemas.contracts import RunEvent, RunResult, duration_ms, parse_iso


def _safe_iso(value: str) -> datetime:
    parsed = parse_iso(value)
    if parsed is not None:
        return parsed
    return datetime.fromtimestamp(0, tz=timezone.utc)


class RunRepository:
    def __init__(self) -> None:
        self._lock = Lock()
        self._runs: dict[str, RunResult] = {}
        self._order: list[str] = []
        self._store = JsonStore(settings.runtime_dir() / "runs.json")
        self._max_records = 10_000
        self._load()

    def _load(self) -> None:
        payload = self._store.load()
        for item in payload:
            try:
                model = RunResult.model_validate(item)
            except Exception:
                continue
            self._runs[model.runId] = model
            self._order.append(model.runId)

    def _persist(self) -> None:
        ordered = [self._runs[run_id].model_dump() for run_id in self._order if run_id in self._runs]
        self._store.save(ordered)

    def save(self, result: RunResult) -> None:
        with self._lock:
            if result.runId not in self._runs:
                self._order.append(result.runId)
            self._runs[result.runId] = result
            while len(self._order) > self._max_records:
                oldest = self._order.pop(0)
                self._runs.pop(oldest, None)
            self._persist()

    def get(self, run_id: str) -> RunResult | None:
        with self._lock:
            return self._runs.get(run_id)

    def list(
        self,
        *,
        status: str | None = None,
        task_id: str | None = None,
        flow_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[int, list[RunResult]]:
        with self._lock:
            records = [self._runs[item] for item in self._order if item in self._runs]
        records.sort(key=lambda item: _safe_iso(item.startedAt), reverse=True)
        filtered: list[RunResult] = []
        for item in records:
            if status and item.status != status:
                continue
            if task_id and item.taskId != task_id:
                continue
            if flow_id and item.flowId != flow_id:
                continue
            filtered.append(item)
        total = len(filtered)
        return total, filtered[offset : offset + limit]

    def filter_events(
        self,
        run_id: str,
        *,
        level: str | None = None,
        node_id: str | None = None,
        node_type: str | None = None,
        keyword: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[int, list[RunEvent]]:
        result = self.get(run_id)
        if result is None:
            return 0, []
        keyword_value = (keyword or "").strip().lower()
        filtered: list[RunEvent] = []
        for item in result.events:
            if level and item.level != level:
                continue
            if node_id and item.nodeId != node_id:
                continue
            if node_type and item.nodeType != node_type:
                continue
            if keyword_value and keyword_value not in item.message.lower():
                continue
            filtered.append(item)
        total = len(filtered)
        return total, filtered[offset : offset + limit]

    def stats(self) -> dict[str, Any]:
        with self._lock:
            records = [self._runs[item] for item in self._order if item in self._runs]
        total = len(records)
        status_counter = Counter(item.status for item in records)
        duration_values = [
            item_duration
            for item in records
            if (item_duration := duration_ms(item.startedAt, item.finishedAt)) is not None
        ]
        duration_values.sort()
        avg_duration = int(sum(duration_values) / len(duration_values)) if duration_values else 0
        if duration_values:
            index = min(int(len(duration_values) * 0.95), len(duration_values) - 1)
            p95 = duration_values[index]
        else:
            p95 = 0

        failure_codes: Counter[str] = Counter()
        for run in records:
            if run.status != "failed":
                continue
            for event in run.events:
                code = event.data.get("errorCode")
                if isinstance(code, str):
                    failure_codes[code] += 1

        return {
            "totalRuns": total,
            "successRuns": status_counter.get("success", 0),
            "failedRuns": status_counter.get("failed", 0),
            "canceledRuns": status_counter.get("canceled", 0),
            "avgDurationMs": avg_duration,
            "p95DurationMs": p95,
            "failureByCode": dict(failure_codes),
            "byStatus": dict(status_counter),
        }

    def recent_failures(self, limit: int = 20) -> list[RunResult]:
        with self._lock:
            records = [self._runs[item] for item in self._order if item in self._runs]
        records.sort(key=lambda item: _safe_iso(item.startedAt), reverse=True)
        failed = [item for item in records if item.status == "failed"]
        return failed[:limit]

    def clear(self) -> None:
        with self._lock:
            self._runs.clear()
            self._order.clear()
            self._persist()


run_repository = RunRepository()
