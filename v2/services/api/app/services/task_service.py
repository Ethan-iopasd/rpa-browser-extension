from __future__ import annotations

import calendar
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone, tzinfo
from queue import Empty, Full, Queue
from threading import Event, Thread
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.core.error_codes import (
    FLOW_VALIDATION_FAILED,
    TASK_INVALID_PAYLOAD,
    TASK_NOT_FOUND,
    TASK_QUEUE_FULL,
    TASK_SCHEDULE_INVALID,
)
from app.core.errors import raise_api_error
from app.repositories.run_repository import run_repository
from app.repositories.task_repository import task_repository
from app.schemas.contracts import (
    CreateTaskRequest,
    FlowModel,
    RetryPolicy,
    RunEvent,
    RunResult,
    TaskDefinition,
    TaskListResponse,
    TaskSchedule,
    SchedulePreviewResponse,
    TaskTriggerResponse,
    UpdateTaskRequest,
    now_iso,
    parse_iso,
)
from app.services.audit_service import append_audit
from app.services.run_service import execute_flow

TIME_OF_DAY_PATTERN = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
WEEKDAY_INDEX: dict[str, int] = {
    "mon": 0,
    "tue": 1,
    "wed": 2,
    "thu": 3,
    "fri": 4,
    "sat": 5,
    "sun": 6,
}


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _as_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _resolve_timezone(tz_name: str | None) -> tzinfo | None:
    candidate = (tz_name or "UTC").strip()
    normalized = candidate.lower()
    if normalized in {"utc", "etc/utc", "z"}:
        return timezone.utc
    try:
        return ZoneInfo(candidate)
    except Exception:
        return None


def _parse_time_of_day(value: str | None) -> tuple[int, int] | None:
    if value is None:
        return None
    text = value.strip()
    if not TIME_OF_DAY_PATTERN.fullmatch(text):
        return None
    hour, minute = text.split(":")
    return int(hour), int(minute)


def _build_cron_trigger(schedule: TaskSchedule):
    try:
        from apscheduler.triggers.cron import CronTrigger
    except ModuleNotFoundError as exc:
        raise_api_error(
            status_code=400,
            code=TASK_SCHEDULE_INVALID,
            message="cron mode requires APScheduler runtime dependency.",
            details={"mode": "cron", "module": "apscheduler", "error": str(exc)},
        )

    expression = (schedule.cronExpr or "").strip()
    if not expression:
        raise_api_error(
            status_code=400,
            code=TASK_SCHEDULE_INVALID,
            message="schedule.cronExpr is required for cron mode.",
            details={"mode": "cron"},
        )

    tz = _resolve_timezone(schedule.timezone)
    if tz is None:
        raise_api_error(
            status_code=400,
            code=TASK_SCHEDULE_INVALID,
            message="schedule.timezone is invalid.",
            details={"mode": "cron", "timezone": schedule.timezone},
        )

    try:
        return CronTrigger.from_crontab(expression, timezone=tz)
    except ValueError as exc:
        raise_api_error(
            status_code=400,
            code=TASK_SCHEDULE_INVALID,
            message="schedule.cronExpr is invalid.",
            details={"mode": "cron", "cronExpr": expression, "error": str(exc)},
        )


def _next_daily_run(schedule: TaskSchedule, base_time: datetime) -> str | None:
    time_of_day = _parse_time_of_day(schedule.timeOfDay)
    tz = _resolve_timezone(schedule.timezone)
    if time_of_day is None or tz is None:
        return None

    hour, minute = time_of_day
    now_local = base_time.astimezone(tz)
    candidate = now_local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= now_local:
        candidate = candidate + timedelta(days=1)
    return _as_iso(candidate)


def _next_weekly_run(schedule: TaskSchedule, base_time: datetime) -> str | None:
    time_of_day = _parse_time_of_day(schedule.timeOfDay)
    tz = _resolve_timezone(schedule.timezone)
    if time_of_day is None or tz is None:
        return None
    weekdays = [
        WEEKDAY_INDEX[item]
        for item in schedule.weekdays
        if item in WEEKDAY_INDEX
    ]
    weekdays = sorted(set(weekdays))
    if len(weekdays) == 0:
        return None

    hour, minute = time_of_day
    now_local = base_time.astimezone(tz)
    for day_offset in range(0, 14):
        candidate_date = now_local.date() + timedelta(days=day_offset)
        if candidate_date.weekday() not in weekdays:
            continue
        candidate = datetime(
            candidate_date.year,
            candidate_date.month,
            candidate_date.day,
            hour,
            minute,
            tzinfo=tz,
        )
        if candidate > now_local:
            return _as_iso(candidate)
    return None


def _next_monthly_run(schedule: TaskSchedule, base_time: datetime) -> str | None:
    time_of_day = _parse_time_of_day(schedule.timeOfDay)
    tz = _resolve_timezone(schedule.timezone)
    if time_of_day is None or tz is None or schedule.dayOfMonth is None:
        return None

    day_of_month = max(1, min(31, schedule.dayOfMonth))
    hour, minute = time_of_day
    now_local = base_time.astimezone(tz)
    current_year = now_local.year
    current_month = now_local.month

    for month_offset in range(0, 25):
        year = current_year + ((current_month - 1 + month_offset) // 12)
        month = ((current_month - 1 + month_offset) % 12) + 1
        last_day = calendar.monthrange(year, month)[1]
        day = min(day_of_month, last_day)
        candidate = datetime(year, month, day, hour, minute, tzinfo=tz)
        if candidate > now_local:
            return _as_iso(candidate)
    return None


def _next_cron_run(schedule: TaskSchedule, base_time: datetime) -> str | None:
    trigger = _build_cron_trigger(schedule)
    next_fire = trigger.get_next_fire_time(previous_fire_time=None, now=base_time)
    if next_fire is None:
        return None
    return _as_iso(next_fire)


def _next_run_from_schedule(schedule: TaskSchedule, base_time: datetime) -> str | None:
    if schedule.mode == "manual":
        return None
    if schedule.mode == "once":
        run_at = parse_iso(schedule.runAt)
        if run_at is None:
            return None
        if run_at <= base_time:
            return None
        return _as_iso(run_at)
    if schedule.mode == "interval":
        interval = schedule.intervalSeconds or 0
        return _as_iso(base_time + timedelta(seconds=max(interval, 1)))
    if schedule.mode == "daily":
        return _next_daily_run(schedule, base_time)
    if schedule.mode == "weekly":
        return _next_weekly_run(schedule, base_time)
    if schedule.mode == "monthly":
        return _next_monthly_run(schedule, base_time)
    if schedule.mode == "cron":
        return _next_cron_run(schedule, base_time)
    return None


def _validate_schedule(schedule: TaskSchedule) -> None:
    if schedule.mode == "manual":
        return

    if schedule.mode == "once":
        if parse_iso(schedule.runAt) is None:
            raise_api_error(
                status_code=400,
                code=TASK_SCHEDULE_INVALID,
                message="schedule.runAt must be valid ISO datetime for once mode.",
                details={"mode": "once"},
            )
        return

    if schedule.mode == "interval":
        if schedule.intervalSeconds is None or schedule.intervalSeconds <= 0:
            raise_api_error(
                status_code=400,
                code=TASK_SCHEDULE_INVALID,
                message="schedule.intervalSeconds must be > 0 for interval mode.",
                details={"mode": "interval"},
            )
        return

    timezone_name = schedule.timezone or "UTC"
    if _resolve_timezone(schedule.timezone) is None:
        raise_api_error(
            status_code=400,
            code=TASK_SCHEDULE_INVALID,
            message="schedule.timezone is invalid.",
            details={"mode": schedule.mode, "timezone": timezone_name},
        )

    if schedule.mode == "daily":
        if _parse_time_of_day(schedule.timeOfDay) is None:
            raise_api_error(
                status_code=400,
                code=TASK_SCHEDULE_INVALID,
                message="schedule.timeOfDay must be HH:MM for daily mode.",
                details={"mode": "daily"},
            )
        return

    if schedule.mode == "weekly":
        if _parse_time_of_day(schedule.timeOfDay) is None:
            raise_api_error(
                status_code=400,
                code=TASK_SCHEDULE_INVALID,
                message="schedule.timeOfDay must be HH:MM for weekly mode.",
                details={"mode": "weekly"},
            )
        if len(schedule.weekdays) == 0:
            raise_api_error(
                status_code=400,
                code=TASK_SCHEDULE_INVALID,
                message="schedule.weekdays must include at least one day for weekly mode.",
                details={"mode": "weekly"},
            )
        return

    if schedule.mode == "monthly":
        if _parse_time_of_day(schedule.timeOfDay) is None:
            raise_api_error(
                status_code=400,
                code=TASK_SCHEDULE_INVALID,
                message="schedule.timeOfDay must be HH:MM for monthly mode.",
                details={"mode": "monthly"},
            )
        if schedule.dayOfMonth is None or schedule.dayOfMonth < 1 or schedule.dayOfMonth > 31:
            raise_api_error(
                status_code=400,
                code=TASK_SCHEDULE_INVALID,
                message="schedule.dayOfMonth must be in [1,31] for monthly mode.",
                details={"mode": "monthly"},
            )
        return

    if schedule.mode == "cron":
        _build_cron_trigger(schedule)


def _validate_task_payload(payload: CreateTaskRequest) -> None:
    if payload.type == "batch":
        if len(payload.batchFlows) == 0:
            raise_api_error(
                status_code=400,
                code=TASK_INVALID_PAYLOAD,
                message="Batch task requires at least one flow in batchFlows.",
                details={},
            )
    else:
        if payload.flow is None:
            raise_api_error(
                status_code=400,
                code=TASK_INVALID_PAYLOAD,
                message="Task flow is required for manual/scheduled task.",
                details={},
            )

    if payload.type == "manual":
        return

    if payload.schedule is None:
        raise_api_error(
            status_code=400,
            code=TASK_SCHEDULE_INVALID,
            message="Scheduled/batch task requires schedule payload.",
            details={},
        )

    schedule = payload.schedule
    _validate_schedule(schedule)
    if schedule.mode == "manual":
        raise_api_error(
            status_code=400,
            code=TASK_SCHEDULE_INVALID,
            message="Scheduled/batch task cannot use manual schedule mode.",
            details={"mode": "manual"},
        )


def _effective_schedule(task_type: str, schedule: TaskSchedule | None) -> TaskSchedule:
    if schedule is not None:
        return schedule
    if task_type == "manual":
        return TaskSchedule(mode="manual")
    return TaskSchedule(mode="interval", intervalSeconds=60)


def _task_flows(task: TaskDefinition) -> list[FlowModel]:
    if task.type == "batch":
        return list(task.batchFlows)
    if task.flow is not None:
        return [task.flow]
    return []


def _build_failed_run(
    *,
    flow_id: str,
    task_id: str,
    trigger_type: str,
    attempt: int,
    code: str,
    message: str,
    details: dict[str, Any],
) -> RunResult:
    run_id = f"run_{uuid4().hex[:12]}"
    timestamp = now_iso()
    event = RunEvent(
        eventId=f"evt_{uuid4().hex[:12]}",
        timestamp=timestamp,
        runId=run_id,
        nodeId="runtime",
        nodeType="start",
        level="error",
        message=message,
        durationMs=None,
        data={"errorCode": code, "details": details},
    )
    result = RunResult(
        runId=run_id,
        flowId=flow_id,
        status="failed",
        startedAt=timestamp,
        finishedAt=timestamp,
        events=[event],
        taskId=task_id,
        triggerType=trigger_type,  # type: ignore[arg-type]
        attempt=attempt,
    )
    run_repository.save(result)
    return result


@dataclass
class QueuedTask:
    task_id: str
    trigger_type: str


class TaskRuntime:
    def __init__(self) -> None:
        self._queue: Queue[QueuedTask] = Queue(maxsize=2000)
        self._stop_event = Event()
        self._workers: list[Thread] = []
        self._poller: Thread | None = None
        self._started = False

    def start(self) -> None:
        if self._started:
            return
        self._started = True
        self._stop_event.clear()
        for worker_id in range(settings.max_concurrency()):
            worker = Thread(target=self._worker_loop, args=(worker_id,), daemon=True)
            worker.start()
            self._workers.append(worker)
        poller = Thread(target=self._poll_loop, daemon=True)
        poller.start()
        self._poller = poller

    def stop(self) -> None:
        if not self._started:
            return
        self._stop_event.set()
        for _ in self._workers:
            try:
                self._queue.put_nowait(QueuedTask(task_id="", trigger_type="manual"))
            except Full:
                break
        for worker in self._workers:
            worker.join(timeout=1)
        if self._poller is not None:
            self._poller.join(timeout=1)
        self._workers = []
        self._poller = None
        self._started = False

    def enqueue(self, task_id: str, trigger_type: str) -> None:
        try:
            self._queue.put_nowait(QueuedTask(task_id=task_id, trigger_type=trigger_type))
        except Full:
            raise_api_error(
                status_code=429,
                code=TASK_QUEUE_FULL,
                message="Task execution queue is full.",
                details={"taskId": task_id},
            )

    def queue_size(self) -> int:
        return self._queue.qsize()

    def _worker_loop(self, worker_id: int) -> None:
        while not self._stop_event.is_set():
            try:
                queued = self._queue.get(timeout=0.5)
            except Empty:
                continue
            try:
                if not queued.task_id:
                    continue
                execute_task_now(queued.task_id, trigger_type=queued.trigger_type)
            finally:
                self._queue.task_done()
        append_audit(
            "task.worker.stop",
            actor="scheduler",
            target=f"worker:{worker_id}",
            metadata={},
        )

    def _poll_loop(self) -> None:
        while not self._stop_event.is_set():
            for task in task_repository.due_tasks():
                schedule = task.schedule
                next_run = _next_run_from_schedule(schedule, _now())
                claimed = task_repository.claim_due_task(task.taskId, next_run_at=next_run)
                if claimed is None:
                    continue
                self.enqueue(task.taskId, "scheduled")
            time.sleep(settings.scheduler_poll_interval_seconds())


task_runtime = TaskRuntime()


def start_runtime() -> None:
    if settings.scheduler_enabled():
        task_runtime.start()


def stop_runtime() -> None:
    task_runtime.stop()


def create_task(payload: CreateTaskRequest, actor: str = "system") -> TaskDefinition:
    _validate_task_payload(payload)
    schedule = _effective_schedule(payload.type, payload.schedule)
    created_at = now_iso()
    next_run = _next_run_from_schedule(schedule, _now())
    if payload.type == "manual":
        next_run = None
    task = TaskDefinition(
        taskId=f"task_{uuid4().hex[:12]}",
        name=payload.name.strip() or "untitled",
        type=payload.type,
        status="active",
        flow=payload.flow,
        batchFlows=payload.batchFlows,
        schedule=schedule,
        runOptions=payload.runOptions,
        retryPolicy=payload.retryPolicy or RetryPolicy(maxRetries=0, retryDelayMs=0),
        tags=payload.tags,
        createdAt=created_at,
        updatedAt=created_at,
        nextRunAt=next_run,
        lastRunAt=None,
        lastRunStatus=None,
        lastRunId=None,
    )
    task_repository.save(task)
    append_audit(
        "task.create",
        actor=actor,
        target=task.taskId,
        metadata={"name": task.name, "type": task.type},
    )
    return task


def get_task(task_id: str) -> TaskDefinition:
    task = task_repository.get(task_id)
    if task is None:
        raise_api_error(
            status_code=404,
            code=TASK_NOT_FOUND,
            message=f"Task not found: {task_id}",
            details={"taskId": task_id},
        )
    return task


def list_tasks(
    *,
    status: str | None = None,
    task_type: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> TaskListResponse:
    total, tasks = task_repository.list(status=status, task_type=task_type, limit=limit, offset=offset)
    return TaskListResponse(total=total, tasks=tasks)


def preview_schedule(
    schedule: TaskSchedule,
    *,
    count: int = 5,
    from_at: str | None = None,
) -> SchedulePreviewResponse:
    _validate_schedule(schedule)
    if schedule.mode == "manual":
        return SchedulePreviewResponse(total=0, nextRuns=[])

    capped_count = min(max(count, 1), 20)
    cursor = parse_iso(from_at) or _now()
    next_runs: list[str] = []
    for _ in range(capped_count):
        next_run = _next_run_from_schedule(schedule, cursor)
        if next_run is None:
            break
        next_runs.append(next_run)
        next_time = parse_iso(next_run)
        if next_time is None:
            break
        if next_time <= cursor:
            cursor = cursor + timedelta(seconds=1)
            continue
        cursor = next_time
    return SchedulePreviewResponse(total=len(next_runs), nextRuns=next_runs)


def update_task(task_id: str, payload: UpdateTaskRequest, actor: str = "system") -> TaskDefinition:
    task = get_task(task_id)
    next_schedule = payload.schedule or task.schedule
    next_type = task.type
    next_flow = task.flow if payload.flow is None else payload.flow
    next_batch = task.batchFlows if payload.batchFlows is None else payload.batchFlows
    candidate = CreateTaskRequest(
        name=payload.name or task.name,
        type=next_type,
        flow=next_flow,
        batchFlows=next_batch,
        schedule=next_schedule,
        runOptions=payload.runOptions if payload.runOptions is not None else task.runOptions,
        retryPolicy=payload.retryPolicy if payload.retryPolicy is not None else task.retryPolicy,
        tags=payload.tags if payload.tags is not None else task.tags,
    )
    _validate_task_payload(candidate)
    next_next_run = task.nextRunAt
    if next_schedule.mode == "manual":
        next_next_run = None
    elif task.status == "active":
        next_next_run = _next_run_from_schedule(next_schedule, _now())
    updated = task.model_copy(
        update={
            "name": payload.name if payload.name is not None else task.name,
            "status": payload.status if payload.status is not None else task.status,
            "flow": next_flow,
            "batchFlows": next_batch,
            "schedule": next_schedule,
            "runOptions": payload.runOptions if payload.runOptions is not None else task.runOptions,
            "retryPolicy": payload.retryPolicy if payload.retryPolicy is not None else task.retryPolicy,
            "tags": payload.tags if payload.tags is not None else task.tags,
            "updatedAt": now_iso(),
            "nextRunAt": next_next_run,
        }
    )
    task_repository.update(updated)
    append_audit(
        "task.update",
        actor=actor,
        target=task_id,
        metadata={"status": updated.status},
    )
    return updated


def pause_task(task_id: str, actor: str = "system") -> TaskDefinition:
    return update_task(task_id, UpdateTaskRequest(status="paused"), actor=actor)


def resume_task(task_id: str, actor: str = "system") -> TaskDefinition:
    task = get_task(task_id)
    next_run = task.nextRunAt
    if task.schedule.mode != "manual":
        next_run = _next_run_from_schedule(task.schedule, _now())
    updated = task.model_copy(
        update={
            "status": "active",
            "updatedAt": now_iso(),
            "nextRunAt": next_run,
        }
    )
    task_repository.update(updated)
    append_audit("task.resume", actor=actor, target=task_id, metadata={})
    return updated


def disable_task(task_id: str, actor: str = "system") -> TaskDefinition:
    updated = update_task(task_id, UpdateTaskRequest(status="disabled"), actor=actor)
    return updated


def delete_task(task_id: str, actor: str = "system") -> TaskDefinition:
    task = get_task(task_id)
    deleted = task_repository.delete(task_id)
    if deleted is None:
        raise_api_error(
            status_code=404,
            code=TASK_NOT_FOUND,
            message=f"Task not found: {task_id}",
            details={"taskId": task_id},
        )
    append_audit(
        "task.delete",
        actor=actor,
        target=task_id,
        metadata={"name": task.name, "type": task.type},
    )
    return deleted


def trigger_task(task_id: str, *, trigger_type: str = "manual", actor: str = "system") -> TaskTriggerResponse:
    task = get_task(task_id)
    if task.status != "active":
        raise_api_error(
            status_code=409,
            code=TASK_INVALID_PAYLOAD,
            message="Task is not active.",
            details={"status": task.status, "taskId": task_id},
        )
    task_runtime.enqueue(task_id, trigger_type)
    append_audit(
        "task.trigger",
        actor=actor,
        target=task_id,
        metadata={"triggerType": trigger_type, "queueSize": task_runtime.queue_size()},
    )
    return TaskTriggerResponse(
        taskId=task_id,
        queuedRuns=1,
        message="Task queued.",
    )


def retry_task_last_failed(task_id: str, actor: str = "system") -> TaskTriggerResponse:
    total, runs = run_repository.list(status="failed", task_id=task_id, limit=1, offset=0)
    if total == 0 or len(runs) == 0:
        raise_api_error(
            status_code=404,
            code=FLOW_VALIDATION_FAILED,
            message=f"No failed run found for task: {task_id}",
            details={"taskId": task_id},
        )
    return trigger_task(task_id, trigger_type="retry", actor=actor)


def execute_task_now(task_id: str, *, trigger_type: str) -> None:
    task = task_repository.get(task_id)
    if task is None or task.status != "active":
        return
    flows = _task_flows(task)
    if len(flows) == 0:
        _build_failed_run(
            flow_id=task.flow.id if task.flow is not None else "unknown",
            task_id=task.taskId,
            trigger_type=trigger_type,
            attempt=0,
            code=FLOW_VALIDATION_FAILED,
            message="Task has no executable flow.",
            details={},
        )
        return

    retry_policy = task.retryPolicy
    last_result: RunResult | None = None
    for flow in flows:
        attempts = retry_policy.maxRetries + 1
        for attempt in range(attempts):
            try:
                result = execute_flow(
                    flow,
                    run_options=task.runOptions,
                    task_id=task.taskId,
                    trigger_type=trigger_type,  # type: ignore[arg-type]
                    attempt=attempt,
                )
            except HTTPException as exc:
                details = {}
                if isinstance(exc.detail, dict):
                    details = exc.detail
                result = _build_failed_run(
                    flow_id=flow.id,
                    task_id=task.taskId,
                    trigger_type=trigger_type,
                    attempt=attempt,
                    code=details.get("code", FLOW_VALIDATION_FAILED),
                    message=details.get("message", "Task execution failed."),
                    details=details.get("details", {}),
                )
            except Exception as exc:  # pragma: no cover
                result = _build_failed_run(
                    flow_id=flow.id,
                    task_id=task.taskId,
                    trigger_type=trigger_type,
                    attempt=attempt,
                    code="TASK_EXECUTION_UNHANDLED",
                    message=f"Unexpected task execution error: {exc}",
                    details={},
                )

            last_result = result
            if result.status == "success":
                break
            if attempt + 1 < attempts and retry_policy.retryDelayMs > 0:
                time.sleep(retry_policy.retryDelayMs / 1000)

    updated = task.model_copy(
        update={
            "updatedAt": now_iso(),
            "lastRunAt": now_iso(),
            "lastRunStatus": last_result.status if last_result is not None else None,
            "lastRunId": last_result.runId if last_result is not None else None,
        }
    )
    if task.schedule.mode == "once":
        updated = updated.model_copy(update={"nextRunAt": None})
    task_repository.update(updated)
    append_audit(
        "task.execute",
        actor="scheduler",
        target=task_id,
        metadata={
            "triggerType": trigger_type,
            "lastRunId": updated.lastRunId,
            "lastRunStatus": updated.lastRunStatus,
        },
    )
