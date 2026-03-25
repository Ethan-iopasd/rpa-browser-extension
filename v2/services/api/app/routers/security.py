from __future__ import annotations

from fastapi import APIRouter, Query

from app.schemas.contracts import (
    AuditListResponse,
    CredentialListResponse,
    CredentialSecretResponse,
    CredentialSummary,
    CredentialsCreateRequest,
)
from app.services.audit_service import list_audit_records
from app.services.credential_service import create_credential, get_credential_secret, list_credentials

router = APIRouter(prefix="/security", tags=["security"])


@router.post("/credentials", response_model=CredentialSummary)
def create_credential_route(payload: CredentialsCreateRequest) -> CredentialSummary:
    return create_credential(payload)


@router.get("/credentials", response_model=CredentialListResponse)
def list_credentials_route(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> CredentialListResponse:
    return list_credentials(limit=limit, offset=offset)


@router.get("/credentials/{credential_id}/secret", response_model=CredentialSecretResponse)
def get_credential_secret_route(credential_id: str) -> CredentialSecretResponse:
    return get_credential_secret(credential_id)


@router.get("/audit", response_model=AuditListResponse)
def list_audit_records_route(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> AuditListResponse:
    return list_audit_records(limit=limit, offset=offset)
