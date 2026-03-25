from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta, timezone
from threading import Lock
from urllib.parse import urlparse

from app.core.errors import raise_api_error
from app.core.native_picker_codes import (
    NATIVE_PICKER_INVALID_PAYLOAD,
    NATIVE_PICKER_PROTOCOL_UNSUPPORTED,
    NATIVE_PICKER_RESULT_INVALID,
    NATIVE_PICKER_SESSION_NOT_FOUND,
    NATIVE_PICKER_SESSION_TERMINAL,
    NATIVE_PICKER_SESSION_TIMEOUT,
)
from app.repositories.native_picker_repository import native_picker_repository
from app.schemas.contracts import PickerResult, now_iso, parse_iso
from app.schemas.native_picker_protocol import (
    NATIVE_PICKER_SCHEMA_VERSION,
    NativePickerEvent,
    NativePickerMessageAck,
    NativePickerMessageEnvelope,
    NativePickerPullResultResponse,
    NativePickerResultRecord,
    NativePickerSession,
    NativePickerSessionCancelRequest,
    NativePickerSessionCreateRequest,
    NativePickerSessionListResponse,
    new_native_picker_session_id,
)

TERMINAL_NATIVE_PICKER_STATUSES = {"succeeded", "failed", "cancelled", "timeout"}


def _is_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


@dataclass
class NativePickerStateTransition:
    session: NativePickerSession
    event_type: str
    payload: dict[str, object]


class NativePickerService:
    def __init__(self) -> None:
        self._lock = Lock()

    def _validate_create_payload(self, payload: NativePickerSessionCreateRequest) -> NativePickerSessionCreateRequest:
        launch_mode = (payload.launchMode or "attach_existing").strip() if isinstance(payload.launchMode, str) else "attach_existing"
        if launch_mode not in {"attach_existing", "open_url"}:
            raise_api_error(
                status_code=400,
                code=NATIVE_PICKER_INVALID_PAYLOAD,
                message="launchMode must be 'attach_existing' or 'open_url'.",
                details={"launchMode": payload.launchMode},
            )

        raw_page_url = payload.pageUrl or ""
        page_url = raw_page_url.strip()
        if launch_mode == "open_url":
            if not _is_http_url(page_url):
                raise_api_error(
                    status_code=400,
                    code=NATIVE_PICKER_INVALID_PAYLOAD,
                    message="pageUrl must start with http:// or https:// when launchMode=open_url.",
                    details={"pageUrl": payload.pageUrl, "launchMode": launch_mode},
                )
        elif page_url and not _is_http_url(page_url):
            raise_api_error(
                status_code=400,
                code=NATIVE_PICKER_INVALID_PAYLOAD,
                message="pageUrl must start with http:// or https:// when provided.",
                details={"pageUrl": payload.pageUrl},
            )

        timeout_ms = int(payload.timeoutMs)
        if timeout_ms < 5_000 or timeout_ms > 600_000:
            raise_api_error(
                status_code=400,
                code=NATIVE_PICKER_INVALID_PAYLOAD,
                message="timeoutMs must be between 5000 and 600000.",
                details={"timeoutMs": payload.timeoutMs},
            )

        node_id = payload.nodeId.strip()
        if not node_id:
            raise_api_error(
                status_code=400,
                code=NATIVE_PICKER_INVALID_PAYLOAD,
                message="nodeId is required.",
                details={"nodeId": payload.nodeId},
            )

        requested_by = (payload.requestedBy or "").strip() or None
        source = payload.source.strip() if payload.source and payload.source.strip() else "designer"
        return payload.model_copy(
            update={
                "pageUrl": page_url,
                "timeoutMs": timeout_ms,
                "nodeId": node_id,
                "launchMode": launch_mode,
                "requestedBy": requested_by,
                "source": source,
            }
        )

    def _mark_timeout_if_needed(self, session: NativePickerSession) -> NativePickerSession:
        if session.status in TERMINAL_NATIVE_PICKER_STATUSES:
            return session
        if not session.expiresAt:
            return session
        expires_at = parse_iso(session.expiresAt)
        if expires_at is None:
            return session
        if expires_at > parse_iso(now_iso()):
            return session
        finished_at = now_iso()
        timed_out = session.model_copy(
            update={
                "status": "timeout",
                "updatedAt": finished_at,
                "finishedAt": finished_at,
                "errorCode": NATIVE_PICKER_SESSION_TIMEOUT,
                "errorMessage": "Native picker session timed out.",
            }
        )
        native_picker_repository.save_session(timed_out)
        native_picker_repository.save_event(
            NativePickerEvent(
                sessionId=session.sessionId,
                eventType="session_timeout",
                source="api",
                payload={"errorCode": NATIVE_PICKER_SESSION_TIMEOUT},
            )
        )
        return timed_out

    def _get_session_or_404(self, session_id: str) -> NativePickerSession:
        session = native_picker_repository.get_session(session_id)
        if session is None:
            raise_api_error(
                status_code=404,
                code=NATIVE_PICKER_SESSION_NOT_FOUND,
                message=f"Native picker session not found: {session_id}",
                details={"sessionId": session_id},
            )
        return self._mark_timeout_if_needed(session)

    def create_session(self, payload: NativePickerSessionCreateRequest) -> NativePickerSession:
        normalized = self._validate_create_payload(payload)
        created_at = now_iso()
        created_dt = parse_iso(created_at)
        if created_dt is None:
            created_dt = parse_iso(now_iso())
        expires_at = (
            (created_dt + timedelta(milliseconds=normalized.timeoutMs))
            .astimezone(timezone.utc)
            .isoformat()
            if created_dt
            else None
        )
        session = NativePickerSession(
            sessionId=new_native_picker_session_id(),
            status="pending",
            nodeId=normalized.nodeId,
            pageUrl=normalized.pageUrl,
            launchMode=normalized.launchMode,
            timeoutMs=normalized.timeoutMs,
            createdAt=created_at,
            updatedAt=created_at,
            expiresAt=expires_at,
            requestedBy=normalized.requestedBy,
            source=normalized.source,
            diagnostics={
                "schemaVersion": NATIVE_PICKER_SCHEMA_VERSION,
                "launchMode": normalized.launchMode,
            },
        )
        with self._lock:
            native_picker_repository.save_session(session)
            native_picker_repository.save_event(
                NativePickerEvent(
                    sessionId=session.sessionId,
                    eventType="session_create",
                    source="api",
                    payload={
                        "nodeId": session.nodeId,
                        "pageUrl": session.pageUrl,
                        "launchMode": session.launchMode,
                        "timeoutMs": session.timeoutMs,
                        "source": session.source,
                    },
                )
            )
        return session

    def get_session(self, session_id: str) -> NativePickerSession:
        return self._get_session_or_404(session_id)

    def list_sessions(self, *, limit: int = 50, offset: int = 0) -> NativePickerSessionListResponse:
        total, sessions = native_picker_repository.list_sessions(limit=limit, offset=offset)
        refreshed = [self._mark_timeout_if_needed(session) for session in sessions]
        return NativePickerSessionListResponse(total=total, sessions=refreshed)

    def cancel_session(self, session_id: str, payload: NativePickerSessionCancelRequest | None = None) -> NativePickerSession:
        actor = payload.actor if payload else "user"
        reason = payload.reason if payload else None
        with self._lock:
            session = self._get_session_or_404(session_id)
            if session.status in TERMINAL_NATIVE_PICKER_STATUSES:
                return session
            updated_at = now_iso()
            cancelled = session.model_copy(
                update={
                    "status": "cancelled",
                    "updatedAt": updated_at,
                    "finishedAt": updated_at,
                    "errorCode": None,
                    "errorMessage": None,
                }
            )
            native_picker_repository.save_session(cancelled)
            native_picker_repository.save_event(
                NativePickerEvent(
                    sessionId=session_id,
                    eventType="session_cancel",
                    source="api",
                    payload={"actor": actor, "reason": reason},
                )
            )
            return cancelled

    def _ack(
        self,
        *,
        ok: bool,
        request_id: str | None,
        session_id: str | None,
        session_status: str | None = None,
        code: str | None = None,
        message: str = "",
        details: dict[str, object] | None = None,
    ) -> NativePickerMessageAck:
        return NativePickerMessageAck(
            ok=ok,
            requestId=request_id,
            sessionId=session_id,
            sessionStatus=session_status,  # type: ignore[arg-type]
            code=code,
            message=message,
            details=details or {},
        )

    def _save_transition(self, transition: NativePickerStateTransition) -> NativePickerSession:
        native_picker_repository.save_session(transition.session)
        native_picker_repository.save_event(
            NativePickerEvent(
                sessionId=transition.session.sessionId,
                eventType=transition.event_type,
                source=str(transition.payload.get("source", "native_host")),
                payload=transition.payload,
            )
        )
        return transition.session

    def handle_message(self, envelope: NativePickerMessageEnvelope, *, source: str = "native_host") -> NativePickerMessageAck:
        if envelope.schemaVersion != NATIVE_PICKER_SCHEMA_VERSION:
            return self._ack(
                ok=False,
                request_id=envelope.requestId,
                session_id=envelope.sessionId,
                code=NATIVE_PICKER_PROTOCOL_UNSUPPORTED,
                message="Unsupported native picker schemaVersion.",
                details={"schemaVersion": envelope.schemaVersion},
            )

        if envelope.type == "ping":
            return self._ack(ok=True, request_id=envelope.requestId, session_id=envelope.sessionId, message="pong")

        session_id = (envelope.sessionId or "").strip()
        if not session_id:
            return self._ack(
                ok=False,
                request_id=envelope.requestId,
                session_id=None,
                code=NATIVE_PICKER_INVALID_PAYLOAD,
                message="sessionId is required for this message type.",
            )

        with self._lock:
            session = native_picker_repository.get_session(session_id)
            if session is None:
                return self._ack(
                    ok=False,
                    request_id=envelope.requestId,
                    session_id=session_id,
                    code=NATIVE_PICKER_SESSION_NOT_FOUND,
                    message=f"Session not found: {session_id}",
                )
            session = self._mark_timeout_if_needed(session)
            if session.status in TERMINAL_NATIVE_PICKER_STATUSES and envelope.type not in {"ack", "heartbeat"}:
                return self._ack(
                    ok=False,
                    request_id=envelope.requestId,
                    session_id=session_id,
                    session_status=session.status,
                    code=NATIVE_PICKER_SESSION_TERMINAL,
                    message=f"Session is already terminal: {session.status}",
                )

            event_payload: dict[str, object] = {
                "source": source,
                "type": envelope.type,
                "requestId": envelope.requestId,
                **(envelope.payload or {}),
            }
            updated_at = now_iso()

            if envelope.type == "session_ready":
                diagnostics = dict(session.diagnostics or {})
                raw_tab_id = envelope.payload.get("tabId")
                if isinstance(raw_tab_id, (int, float)):
                    diagnostics["tabId"] = int(raw_tab_id)
                transition = NativePickerStateTransition(
                    session=session.model_copy(update={"status": "ready", "updatedAt": updated_at, "diagnostics": diagnostics}),
                    event_type="session_ready",
                    payload=event_payload,
                )
                next_session = self._save_transition(transition)
                return self._ack(
                    ok=True,
                    request_id=envelope.requestId,
                    session_id=session_id,
                    session_status=next_session.status,
                    message="Session is ready for picking.",
                )

            if envelope.type == "heartbeat":
                native_picker_repository.save_event(
                    NativePickerEvent(
                        sessionId=session_id,
                        eventType="heartbeat",
                        source=source,
                        payload=event_payload,
                    )
                )
                return self._ack(
                    ok=True,
                    request_id=envelope.requestId,
                    session_id=session_id,
                    session_status=session.status,
                    message="Heartbeat received.",
                )

            if envelope.type == "pick_result":
                result_payload = envelope.payload.get("result", envelope.payload)
                try:
                    picker_result = PickerResult.model_validate(result_payload)
                except Exception as exc:
                    return self._ack(
                        ok=False,
                        request_id=envelope.requestId,
                        session_id=session_id,
                        session_status=session.status,
                        code=NATIVE_PICKER_RESULT_INVALID,
                        message="Invalid picker result payload.",
                        details={"reason": str(exc)},
                    )

                succeeded = session.model_copy(
                    update={
                        "status": "succeeded",
                        "updatedAt": updated_at,
                        "finishedAt": updated_at,
                        "errorCode": None,
                        "errorMessage": None,
                    }
                )
                self._save_transition(
                    NativePickerStateTransition(
                        session=succeeded,
                        event_type="pick_result",
                        payload=event_payload,
                    )
                )
                native_picker_repository.save_result(
                    NativePickerResultRecord(
                        sessionId=session_id,
                        createdAt=updated_at,
                        source=source,
                        result=picker_result,
                    )
                )
                return self._ack(
                    ok=True,
                    request_id=envelope.requestId,
                    session_id=session_id,
                    session_status=succeeded.status,
                    message="Picker result accepted.",
                )

            if envelope.type == "error":
                error_code = str(envelope.payload.get("errorCode", NATIVE_PICKER_RESULT_INVALID))
                error_message = str(envelope.payload.get("errorMessage", "Native picker reported an error."))
                failed = session.model_copy(
                    update={
                        "status": "failed",
                        "updatedAt": updated_at,
                        "finishedAt": updated_at,
                        "errorCode": error_code,
                        "errorMessage": error_message,
                    }
                )
                self._save_transition(
                    NativePickerStateTransition(
                        session=failed,
                        event_type="session_error",
                        payload=event_payload,
                    )
                )
                return self._ack(
                    ok=True,
                    request_id=envelope.requestId,
                    session_id=session_id,
                    session_status=failed.status,
                    message="Error state recorded.",
                )

            if envelope.type == "cancel":
                cancelled = session.model_copy(
                    update={
                        "status": "cancelled",
                        "updatedAt": updated_at,
                        "finishedAt": updated_at,
                    }
                )
                self._save_transition(
                    NativePickerStateTransition(
                        session=cancelled,
                        event_type="session_cancel",
                        payload=event_payload,
                    )
                )
                return self._ack(
                    ok=True,
                    request_id=envelope.requestId,
                    session_id=session_id,
                    session_status=cancelled.status,
                    message="Session cancelled.",
                )

            if envelope.type in {"ack", "session_create"}:
                native_picker_repository.save_event(
                    NativePickerEvent(
                        sessionId=session_id,
                        eventType=envelope.type,
                        source=source,
                        payload=event_payload,
                    )
                )
                return self._ack(
                    ok=True,
                    request_id=envelope.requestId,
                    session_id=session_id,
                    session_status=session.status,
                    message=f"{envelope.type} accepted.",
                )

            return self._ack(
                ok=False,
                request_id=envelope.requestId,
                session_id=session_id,
                session_status=session.status,
                code=NATIVE_PICKER_PROTOCOL_UNSUPPORTED,
                message=f"Unsupported message type: {envelope.type}",
            )

    def pull_result(self, *, session_id: str | None = None) -> NativePickerPullResultResponse:
        record = native_picker_repository.pull_result(session_id=session_id, consumed_at=now_iso())
        if record is None:
            return NativePickerPullResultResponse(found=False, result=None)
        return NativePickerPullResultResponse(found=True, result=record)

    def stop(self) -> None:
        return


native_picker_service = NativePickerService()


def create_native_picker_session(payload: NativePickerSessionCreateRequest) -> NativePickerSession:
    return native_picker_service.create_session(payload)


def get_native_picker_session(session_id: str) -> NativePickerSession:
    return native_picker_service.get_session(session_id)


def list_native_picker_sessions(*, limit: int = 50, offset: int = 0) -> NativePickerSessionListResponse:
    return native_picker_service.list_sessions(limit=limit, offset=offset)


def cancel_native_picker_session(
    session_id: str,
    payload: NativePickerSessionCancelRequest | None = None,
) -> NativePickerSession:
    return native_picker_service.cancel_session(session_id, payload)


def handle_native_picker_message(
    envelope: NativePickerMessageEnvelope,
    *,
    source: str = "native_host",
) -> NativePickerMessageAck:
    return native_picker_service.handle_message(envelope, source=source)


def pull_native_picker_result(*, session_id: str | None = None) -> NativePickerPullResultResponse:
    return native_picker_service.pull_result(session_id=session_id)


def stop_native_picker_runtime() -> None:
    native_picker_service.stop()
