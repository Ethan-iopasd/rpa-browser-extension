from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.core.run_broadcaster import run_broadcaster
from app.repositories.run_repository import run_repository
from app.schemas.contracts import (
    AlertsResponse,
    ExportedRunLogs,
    RunEventsResponse,
    RunListResponse,
    RunResult,
    RunStatsResponse,
    StartRunRequest,
)
from app.services.run_service import (
    export_run_events,
    get_alerts,
    get_run,
    get_run_events,
    get_run_stats,
    list_runs,
    start_run,
)

router = APIRouter(prefix="/runs", tags=["runs"])


@router.websocket("/{run_id}/ws")
async def stream_run_events(websocket: WebSocket, run_id: str) -> None:
    """
    WebSocket 端点：实时推送运行事件。

    - 连接后立即检查 run 是否已完成；若已完成，从 repository 读取事件并推送后断开。
    - 若 run 仍在进行中，等待广播器推送完成事件（最多等待 10 分钟），然后推送并断开。
    - 推送格式：JSON 字符串，包含 `{ "type": "run_done", "events": [...] }`。
    """
    await websocket.accept()
    try:
        # 先检查 run 是否已经完成存储
        existing = run_repository.get(run_id)
        if existing is not None:
            payload = json.dumps(
                {
                    "type": "run_done",
                    "runId": run_id,
                    "status": existing.status,
                    "events": [evt.model_dump() for evt in existing.events],
                },
                ensure_ascii=False,
            )
            await websocket.send_text(payload)
            return

        # run 尚未完成，订阅广播器等待
        queue = run_broadcaster.subscribe(run_id)
        try:
            # 等待广播，最多 10 分钟
            events = await asyncio.wait_for(queue.get(), timeout=600.0)
            # 再次检查状态（广播后事件已经存入 repository）
            finished = run_repository.get(run_id)
            status = finished.status if finished is not None else "unknown"
            payload = json.dumps(
                {
                    "type": "run_done",
                    "runId": run_id,
                    "status": status,
                    "events": events,
                },
                ensure_ascii=False,
            )
            await websocket.send_text(payload)
        except asyncio.TimeoutError:
            await websocket.send_text(
                json.dumps({"type": "timeout", "runId": run_id, "message": "Run timed out or not started."})
            )
        finally:
            run_broadcaster.unsubscribe(run_id, queue)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass



@router.post("", response_model=RunResult)
def start_run_route(payload: StartRunRequest) -> RunResult:
    return start_run(payload)


@router.get("", response_model=RunListResponse)
def list_runs_route(
    status: str | None = None,
    taskId: str | None = None,
    flowId: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> RunListResponse:
    total, runs = list_runs(status=status, task_id=taskId, flow_id=flowId, limit=limit, offset=offset)
    return RunListResponse(total=total, runs=runs)


@router.get("/stats", response_model=RunStatsResponse)
def get_run_stats_route() -> RunStatsResponse:
    return get_run_stats()


@router.get("/alerts", response_model=AlertsResponse)
def get_alerts_route() -> AlertsResponse:
    return get_alerts()


@router.get("/{run_id}", response_model=RunResult)
def get_run_route(run_id: str) -> RunResult:
    return get_run(run_id)


@router.get("/{run_id}/events", response_model=RunEventsResponse)
def get_run_events_route(
    run_id: str,
    level: str | None = None,
    nodeId: str | None = None,
    nodeType: str | None = None,
    keyword: str | None = None,
    limit: int = Query(default=100, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
) -> RunEventsResponse:
    return get_run_events(
        run_id,
        level=level,
        node_id=nodeId,
        node_type=nodeType,
        keyword=keyword,
        limit=limit,
        offset=offset,
    )


@router.get("/{run_id}/export", response_model=ExportedRunLogs)
def export_run_events_route(
    run_id: str,
    format: str = Query(default="jsonl"),
    level: str | None = None,
    nodeId: str | None = None,
    nodeType: str | None = None,
    keyword: str | None = None,
) -> ExportedRunLogs:
    return export_run_events(
        run_id,
        export_format=format,
        level=level,
        node_id=nodeId,
        node_type=nodeType,
        keyword=keyword,
    )
