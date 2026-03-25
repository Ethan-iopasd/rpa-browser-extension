from __future__ import annotations

from uuid import uuid4

from app.repositories.audit_repository import audit_repository
from app.schemas.contracts import AuditListResponse, AuditRecord, now_iso


def append_audit(action: str, *, actor: str, target: str, metadata: dict[str, object] | None = None) -> None:
    record = AuditRecord(
        auditId=f"audit_{uuid4().hex[:12]}",
        action=action,
        actor=actor,
        target=target,
        timestamp=now_iso(),
        metadata=metadata or {},
    )
    audit_repository.append(record)


def list_audit_records(limit: int = 100, offset: int = 0) -> AuditListResponse:
    total, records = audit_repository.list(limit=limit, offset=offset)
    return AuditListResponse(total=total, records=records)
