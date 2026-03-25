from __future__ import annotations

from fastapi import APIRouter

from app.schemas.contracts import FlowModel, ValidateResponse
from app.services.run_service import validate_flow

router = APIRouter(prefix="/flows", tags=["flows"])


@router.post("/validate", response_model=ValidateResponse)
def validate_flow_route(flow: FlowModel) -> ValidateResponse:
    return validate_flow(flow)
