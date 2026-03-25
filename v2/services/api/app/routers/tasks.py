from __future__ import annotations

from fastapi import APIRouter, Query

from app.schemas.contracts import (
    CreateTaskRequest,
    RunListResponse,
    TaskDefinition,
    TaskListResponse,
    SchedulePreviewRequest,
    SchedulePreviewResponse,
    TaskTriggerResponse,
    UpdateTaskRequest,
)
from app.services.run_service import list_runs
from app.services.task_service import (
    create_task,
    delete_task,
    disable_task,
    get_task,
    list_tasks,
    pause_task,
    preview_schedule,
    resume_task,
    retry_task_last_failed,
    trigger_task,
    update_task,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.post("", response_model=TaskDefinition)
def create_task_route(payload: CreateTaskRequest) -> TaskDefinition:
    return create_task(payload)


@router.get("", response_model=TaskListResponse)
def list_tasks_route(
    status: str | None = None,
    type: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> TaskListResponse:
    return list_tasks(status=status, task_type=type, limit=limit, offset=offset)


@router.get("/{task_id}", response_model=TaskDefinition)
def get_task_route(task_id: str) -> TaskDefinition:
    return get_task(task_id)


@router.patch("/{task_id}", response_model=TaskDefinition)
def update_task_route(task_id: str, payload: UpdateTaskRequest) -> TaskDefinition:
    return update_task(task_id, payload)


@router.delete("/{task_id}", response_model=TaskDefinition)
def delete_task_route(task_id: str) -> TaskDefinition:
    return delete_task(task_id)


@router.post("/{task_id}/trigger", response_model=TaskTriggerResponse)
def trigger_task_route(task_id: str) -> TaskTriggerResponse:
    return trigger_task(task_id, trigger_type="manual")


@router.post("/{task_id}/retry-last-failed", response_model=TaskTriggerResponse)
def retry_task_route(task_id: str) -> TaskTriggerResponse:
    return retry_task_last_failed(task_id)


@router.post("/{task_id}/pause", response_model=TaskDefinition)
def pause_task_route(task_id: str) -> TaskDefinition:
    return pause_task(task_id)


@router.post("/{task_id}/resume", response_model=TaskDefinition)
def resume_task_route(task_id: str) -> TaskDefinition:
    return resume_task(task_id)


@router.post("/{task_id}/disable", response_model=TaskDefinition)
def disable_task_route(task_id: str) -> TaskDefinition:
    return disable_task(task_id)


@router.post("/schedule/preview", response_model=SchedulePreviewResponse)
def preview_schedule_route(payload: SchedulePreviewRequest) -> SchedulePreviewResponse:
    return preview_schedule(payload.schedule, count=payload.count, from_at=payload.fromAt)


@router.get("/{task_id}/runs", response_model=RunListResponse)
def get_task_runs_route(
    task_id: str,
    status: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> RunListResponse:
    total, runs = list_runs(status=status, task_id=task_id, limit=limit, offset=offset)
    return RunListResponse(total=total, runs=runs)
