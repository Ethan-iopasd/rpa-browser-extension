from __future__ import annotations

from uuid import uuid4

from app.core.error_codes import CREDENTIAL_NOT_FOUND
from app.core.errors import raise_api_error
from app.repositories.credential_repository import credential_repository
from app.schemas.contracts import (
    CredentialListResponse,
    CredentialSecretResponse,
    CredentialSummary,
    CredentialsCreateRequest,
    now_iso,
)
from app.services.audit_service import append_audit
from app.services.security_service import decrypt_secret, encrypt_secret


def create_credential(payload: CredentialsCreateRequest, actor: str = "system") -> CredentialSummary:
    timestamp = now_iso()
    credential_id = f"cred_{uuid4().hex[:12]}"
    encrypted_value = encrypt_secret(payload.value)
    record = {
        "credentialId": credential_id,
        "name": payload.name,
        "description": payload.description,
        "encryptedValue": encrypted_value,
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    credential_repository.save(record)
    append_audit(
        "credential.create",
        actor=actor,
        target=credential_id,
        metadata={"name": payload.name},
    )
    return CredentialSummary(
        credentialId=credential_id,
        name=payload.name,
        description=payload.description,
        createdAt=timestamp,
        updatedAt=timestamp,
    )


def list_credentials(limit: int = 100, offset: int = 0) -> CredentialListResponse:
    total, records = credential_repository.list(limit=limit, offset=offset)
    summaries = [
        CredentialSummary(
            credentialId=item["credentialId"],
            name=item["name"],
            description=item.get("description"),
            createdAt=item["createdAt"],
            updatedAt=item["updatedAt"],
        )
        for item in records
    ]
    return CredentialListResponse(total=total, credentials=summaries)


def get_credential_secret(credential_id: str, actor: str = "system") -> CredentialSecretResponse:
    record = credential_repository.get(credential_id)
    if record is None:
        raise_api_error(
            status_code=404,
            code=CREDENTIAL_NOT_FOUND,
            message=f"Credential not found: {credential_id}",
            details={"credentialId": credential_id},
        )
    secret = decrypt_secret(record["encryptedValue"])
    append_audit(
        "credential.read_secret",
        actor=actor,
        target=credential_id,
        metadata={},
    )
    return CredentialSecretResponse(
        credentialId=record["credentialId"],
        name=record["name"],
        value=secret,
        updatedAt=record["updatedAt"],
    )
