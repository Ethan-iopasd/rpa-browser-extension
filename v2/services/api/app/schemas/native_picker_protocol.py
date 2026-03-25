from __future__ import annotations

from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field

from app.schemas.contracts import PickerResult, now_iso

NATIVE_PICKER_SCHEMA_VERSION = "native-picker.v1"
NativePickerMessageType = Literal[
    "ping",
    "session_create",
    "session_ready",
    "pick_result",
    "ack",
    "cancel",
    "error",
    "heartbeat",
]
NativePickerSessionStatus = Literal[
    "pending",
    "ready",
    "picking",
    "succeeded",
    "failed",
    "cancelled",
    "timeout",
]
NativePickerLaunchMode = Literal[
    "attach_existing",
    "open_url",
]


def new_native_picker_session_id() -> str:
    return f"npk_{uuid4().hex[:12]}"


class NativePickerSessionCreateRequest(BaseModel):
    nodeId: str
    pageUrl: str | None = None
    launchMode: NativePickerLaunchMode = "attach_existing"
    timeoutMs: int = 180_000
    requestedBy: str | None = None
    source: str = "designer"


class NativePickerSessionCancelRequest(BaseModel):
    actor: str = "user"
    reason: str | None = None


class NativePickerSession(BaseModel):
    sessionId: str
    status: NativePickerSessionStatus = "pending"
    nodeId: str
    pageUrl: str = ""
    launchMode: NativePickerLaunchMode = "attach_existing"
    timeoutMs: int
    createdAt: str
    updatedAt: str
    expiresAt: str | None = None
    finishedAt: str | None = None
    requestedBy: str | None = None
    source: str = "designer"
    errorCode: str | None = None
    errorMessage: str | None = None
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class NativePickerSessionListResponse(BaseModel):
    total: int
    sessions: list[NativePickerSession] = Field(default_factory=list)


class NativePickerEvent(BaseModel):
    eventId: int | None = None
    sessionId: str
    eventType: str
    createdAt: str = Field(default_factory=now_iso)
    source: str = "api"
    payload: dict[str, Any] = Field(default_factory=dict)


class NativePickerResultRecord(BaseModel):
    sessionId: str
    createdAt: str = Field(default_factory=now_iso)
    consumedAt: str | None = None
    source: str = "api"
    result: PickerResult


class NativePickerPullResultResponse(BaseModel):
    found: bool = False
    result: NativePickerResultRecord | None = None


class NativePickerMessageEnvelope(BaseModel):
    schemaVersion: str = NATIVE_PICKER_SCHEMA_VERSION
    type: NativePickerMessageType
    requestId: str | None = None
    sessionId: str | None = None
    source: str | None = None
    timestamp: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class NativePickerMessageAck(BaseModel):
    schemaVersion: str = NATIVE_PICKER_SCHEMA_VERSION
    ok: bool = True
    requestId: str | None = None
    sessionId: str | None = None
    sessionStatus: NativePickerSessionStatus | None = None
    code: str | None = None
    message: str = ""
    details: dict[str, Any] = Field(default_factory=dict)
    serverTime: str = Field(default_factory=now_iso)
