from __future__ import annotations

from fastapi import APIRouter

from app.schemas.contracts import FLOW_SCHEMA_VERSION
from app.services.task_service import task_runtime

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str | int]:
    return {
        "status": "ok",
        "schemaVersion": FLOW_SCHEMA_VERSION,
        "taskQueueSize": task_runtime.queue_size(),
    }
