from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from typing import Any

from app.core.config import settings
from app.schemas.contracts import FlowModel, RunEvent, RunResult

SENSITIVE_KEYWORDS = ("password", "token", "secret", "cookie", "authorization", "apikey", "api_key")
MASK = "***"


def _mask_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: mask_sensitive_data(key, item) for key, item in value.items()}
    if isinstance(value, list):
        return [_mask_value(item) for item in value]
    return value


def mask_sensitive_data(key: str, value: Any) -> Any:
    lowered = key.lower()
    if any(keyword in lowered for keyword in SENSITIVE_KEYWORDS):
        return MASK
    return _mask_value(value)


def sanitize_run_result(result: RunResult) -> RunResult:
    sanitized_events: list[RunEvent] = []
    for event in result.events:
        sanitized_events.append(
            RunEvent(
                eventId=event.eventId,
                timestamp=event.timestamp,
                runId=event.runId,
                nodeId=event.nodeId,
                nodeType=event.nodeType,
                level=event.level,
                message=event.message,
                durationMs=event.durationMs,
                data={key: mask_sensitive_data(key, value) for key, value in event.data.items()},
            )
        )
    flow_snapshot = None
    if result.flowSnapshot is not None:
        flow_snapshot = FlowModel.model_validate(_mask_value(result.flowSnapshot.model_dump()))

    return RunResult(
        runId=result.runId,
        flowId=result.flowId,
        flowSnapshot=flow_snapshot,
        status=result.status,
        startedAt=result.startedAt,
        finishedAt=result.finishedAt,
        events=sanitized_events,
        taskId=result.taskId,
        triggerType=result.triggerType,
        attempt=result.attempt,
    )


def _fallback_key() -> bytes:
    base = settings.credential_key() or os.getenv("COMPUTERNAME", "rpa-flow-dev")
    return hashlib.sha256(base.encode("utf-8")).digest()


def crypto_available() -> bool:
    try:
        from cryptography.fernet import Fernet  # noqa: F401
    except Exception:
        return False
    return True


def _fernet_instance() -> Any:
    from cryptography.fernet import Fernet

    configured = settings.credential_key()
    if configured:
        key_bytes = configured.encode("utf-8")
        try:
            return Fernet(key_bytes)
        except Exception:
            digest = hashlib.sha256(key_bytes).digest()
            token_key = base64.urlsafe_b64encode(digest)
            return Fernet(token_key)
    token_key = base64.urlsafe_b64encode(_fallback_key())
    return Fernet(token_key)


def encrypt_secret(value: str) -> str:
    if crypto_available():
        cipher = _fernet_instance()
        return cipher.encrypt(value.encode("utf-8")).decode("utf-8")
    key = _fallback_key()
    raw = value.encode("utf-8")
    encrypted = bytes(raw[idx] ^ key[idx % len(key)] for idx in range(len(raw)))
    signature = hmac.new(key, encrypted, hashlib.sha256).hexdigest()
    payload = {"sig": signature, "data": base64.b64encode(encrypted).decode("ascii")}
    return f"fallback:{base64.b64encode(json.dumps(payload).encode('utf-8')).decode('ascii')}"


def decrypt_secret(value: str) -> str:
    if crypto_available() and not value.startswith("fallback:"):
        cipher = _fernet_instance()
        return cipher.decrypt(value.encode("utf-8")).decode("utf-8")
    if not value.startswith("fallback:"):
        raise ValueError("Unsupported secret format.")
    payload_raw = base64.b64decode(value.replace("fallback:", "", 1))
    payload = json.loads(payload_raw.decode("utf-8"))
    encrypted = base64.b64decode(payload["data"])
    key = _fallback_key()
    expected_sig = hmac.new(key, encrypted, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_sig, payload["sig"]):
        raise ValueError("Secret signature verification failed.")
    decrypted = bytes(encrypted[idx] ^ key[idx % len(key)] for idx in range(len(encrypted)))
    return decrypted.decode("utf-8")
