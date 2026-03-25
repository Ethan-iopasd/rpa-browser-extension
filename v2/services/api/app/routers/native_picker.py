from __future__ import annotations

from fastapi import APIRouter, Body, Query

from app.schemas.native_picker_protocol import (
    NativePickerMessageAck,
    NativePickerMessageEnvelope,
    NativePickerPullResultResponse,
    NativePickerSession,
    NativePickerSessionCancelRequest,
    NativePickerSessionCreateRequest,
    NativePickerSessionListResponse,
)
from app.services.native_picker_service import (
    cancel_native_picker_session,
    create_native_picker_session,
    get_native_picker_session,
    handle_native_picker_message,
    list_native_picker_sessions,
    pull_native_picker_result,
)

router = APIRouter(prefix="/native-picker", tags=["native-picker"])


@router.post("/sessions", response_model=NativePickerSession)
def create_native_picker_session_route(payload: NativePickerSessionCreateRequest) -> NativePickerSession:
    return create_native_picker_session(payload)


@router.get("/sessions/{session_id}", response_model=NativePickerSession)
def get_native_picker_session_route(session_id: str) -> NativePickerSession:
    return get_native_picker_session(session_id)


@router.get("/sessions", response_model=NativePickerSessionListResponse)
def list_native_picker_sessions_route(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> NativePickerSessionListResponse:
    return list_native_picker_sessions(limit=limit, offset=offset)


@router.post("/sessions/{session_id}/cancel", response_model=NativePickerSession)
def cancel_native_picker_session_route(
    session_id: str,
    payload: NativePickerSessionCancelRequest | None = Body(default=None),
) -> NativePickerSession:
    return cancel_native_picker_session(session_id, payload)


@router.get("/results/pull", response_model=NativePickerPullResultResponse)
def pull_native_picker_result_route(
    session_id: str | None = Query(default=None, alias="sessionId"),
) -> NativePickerPullResultResponse:
    return pull_native_picker_result(session_id=session_id)


@router.post("/messages", response_model=NativePickerMessageAck)
def ingest_native_picker_message_route(payload: NativePickerMessageEnvelope) -> NativePickerMessageAck:
    return handle_native_picker_message(payload, source="api")
