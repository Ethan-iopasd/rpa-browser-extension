from __future__ import annotations

from fastapi import APIRouter

from app.schemas.contracts import PickerSession, StartPickerSessionRequest
from app.services.picker_service import cancel_picker_session, get_picker_session, start_picker_session

router = APIRouter(prefix="/picker", tags=["picker"])


@router.post("/sessions", response_model=PickerSession)
def start_picker_session_route(payload: StartPickerSessionRequest) -> PickerSession:
    return start_picker_session(payload)


@router.get("/sessions/{session_id}", response_model=PickerSession)
def get_picker_session_route(session_id: str) -> PickerSession:
    return get_picker_session(session_id)


@router.post("/sessions/{session_id}/cancel", response_model=PickerSession)
def cancel_picker_session_route(session_id: str) -> PickerSession:
    return cancel_picker_session(session_id)

