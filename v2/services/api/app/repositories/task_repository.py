from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock

from app.core.config import settings
from app.repositories.json_store import JsonStore
from app.schemas.contracts import TaskDefinition, parse_iso


def _now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


class TaskRepository:
    def __init__(self) -> None:
        self._lock = Lock()
        self._tasks: dict[str, TaskDefinition] = {}
        self._order: list[str] = []
        self._store = JsonStore(settings.runtime_dir() / "tasks.json")
        self._load()

    def _load(self) -> None:
        payload = self._store.load()
        for item in payload:
            try:
                task = TaskDefinition.model_validate(item)
            except Exception:
                continue
            self._tasks[task.taskId] = task
            self._order.append(task.taskId)

    def _persist(self) -> None:
        ordered = [self._tasks[item].model_dump() for item in self._order if item in self._tasks]
        self._store.save(ordered)

    def save(self, task: TaskDefinition) -> None:
        with self._lock:
            if task.taskId not in self._tasks:
                self._order.append(task.taskId)
            self._tasks[task.taskId] = task
            self._persist()

    def get(self, task_id: str) -> TaskDefinition | None:
        with self._lock:
            return self._tasks.get(task_id)

    def list(
        self,
        *,
        status: str | None = None,
        task_type: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[int, list[TaskDefinition]]:
        with self._lock:
            records = [self._tasks[item] for item in self._order if item in self._tasks]
        records.sort(key=lambda item: item.createdAt, reverse=True)
        filtered: list[TaskDefinition] = []
        for item in records:
            if status and item.status != status:
                continue
            if task_type and item.type != task_type:
                continue
            filtered.append(item)
        total = len(filtered)
        return total, filtered[offset : offset + limit]

    def update(self, task: TaskDefinition) -> None:
        self.save(task)

    def delete(self, task_id: str) -> TaskDefinition | None:
        with self._lock:
            task = self._tasks.pop(task_id, None)
            if task is None:
                return None
            self._order = [item for item in self._order if item != task_id]
            self._persist()
            return task

    def claim_due_task(self, task_id: str, *, next_run_at: str | None) -> TaskDefinition | None:
        now = _now_utc()
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return None
            if task.status != "active":
                return None
            if task.schedule.mode == "manual":
                return None
            current_next = parse_iso(task.nextRunAt)
            if current_next is None or current_next > now:
                return None
            updated = task.model_copy(
                update={
                    "nextRunAt": next_run_at,
                    "updatedAt": now.isoformat(),
                }
            )
            self._tasks[task_id] = updated
            self._persist()
            return updated

    def due_tasks(self) -> list[TaskDefinition]:
        now = _now_utc()
        with self._lock:
            records = [self._tasks[item] for item in self._order if item in self._tasks]
        due: list[TaskDefinition] = []
        for task in records:
            if task.status != "active":
                continue
            if task.schedule.mode == "manual":
                continue
            next_run = parse_iso(task.nextRunAt)
            if next_run is None:
                continue
            if next_run <= now:
                due.append(task)
        return due

    def clear(self) -> None:
        with self._lock:
            self._tasks.clear()
            self._order.clear()
            self._persist()


task_repository = TaskRepository()
