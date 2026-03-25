from __future__ import annotations

import importlib
from dataclasses import dataclass
from threading import Event, Lock, Thread
from typing import Callable
from urllib.parse import urlparse
from uuid import uuid4

from app.core.error_codes import (
    PICKER_CANCELED,
    PICKER_EXECUTION_FAILED,
    PICKER_INVALID_PAYLOAD,
    PICKER_RUNTIME_UNAVAILABLE,
    PICKER_SESSION_NOT_FOUND,
    PICKER_TIMEOUT,
)
from app.core.errors import raise_api_error
from app.repositories.picker_repository import picker_repository
from app.schemas.contracts import PickerResult, PickerSession, StartPickerSessionRequest, now_iso

TERMINAL_PICKER_STATUS = {"succeeded", "failed", "cancelled"}


def _is_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


@dataclass
class PickerServiceError(Exception):
    code: str
    message: str
    details: dict[str, object]

    def __str__(self) -> str:
        return self.message


@dataclass
class SessionRunner:
    cancel_event: Event
    thread: Thread


def _pick_with_agent(
    *,
    url: str,
    timeout_ms: int,
    headless: bool,
    should_cancel: Callable[[], bool],
) -> PickerResult:
    try:
        agent_picker = importlib.import_module("agent.runtime.picker")
    except ModuleNotFoundError as exc:
        raise PickerServiceError(
            code=PICKER_RUNTIME_UNAVAILABLE,
            message="Agent picker runtime is not installed in current environment.",
            details={"hint": "Install editable package: .\\apps\\agent[dev]"},
        ) from exc
    try:
        pick_element = getattr(agent_picker, "pick_element")
        agent_result = pick_element(
            url=url,
            timeout_ms=timeout_ms,
            headless=headless,
            should_cancel=should_cancel,
        )
        payload = agent_result.model_dump() if hasattr(agent_result, "model_dump") else agent_result
        return PickerResult.model_validate(payload)
    except Exception as exc:  # pragma: no cover - runtime dependent
        code = PICKER_EXECUTION_FAILED
        details: dict[str, object] = {"reason": str(exc)}
        candidate_code = getattr(exc, "code", None)
        if isinstance(candidate_code, str) and candidate_code.strip():
            upper = candidate_code.strip().upper()
            if "TIMEOUT" in upper:
                code = PICKER_TIMEOUT
            elif "CANCEL" in upper:
                code = PICKER_CANCELED
            else:
                code = candidate_code.strip()
        candidate_details = getattr(exc, "details", None)
        if isinstance(candidate_details, dict):
            details = candidate_details
        raise PickerServiceError(
            code=code,
            message=str(exc).strip() or "Native picker execution failed.",
            details=details,
        ) from exc


class PickerRuntime:
    def __init__(self) -> None:
        self._lock = Lock()
        self._runners: dict[str, SessionRunner] = {}
        self._recover_stale_sessions()

    def _recover_stale_sessions(self) -> None:
        _, sessions = picker_repository.list(limit=2_000, offset=0)
        for session in sessions:
            if session.status in TERMINAL_PICKER_STATUS:
                continue
            recovered = session.model_copy(
                update={
                    "status": "failed",
                    "finishedAt": now_iso(),
                    "errorCode": PICKER_EXECUTION_FAILED,
                    "errorMessage": "Picker session interrupted by service restart.",
                    "diagnostics": {**session.diagnostics, "recovered": True},
                }
            )
            picker_repository.save(recovered)

    def _validate_payload(self, payload: StartPickerSessionRequest) -> StartPickerSessionRequest:
        url = payload.url.strip()
        if not _is_http_url(url):
            raise_api_error(
                status_code=400,
                code=PICKER_INVALID_PAYLOAD,
                message="Picker URL must start with http:// or https://",
                details={"url": payload.url},
            )
        timeout_ms = int(payload.timeoutMs)
        if timeout_ms < 5_000 or timeout_ms > 600_000:
            raise_api_error(
                status_code=400,
                code=PICKER_INVALID_PAYLOAD,
                message="timeoutMs must be between 5000 and 600000.",
                details={"timeoutMs": payload.timeoutMs},
            )
        return payload.model_copy(update={"url": url, "timeoutMs": timeout_ms})

    def start_session(self, payload: StartPickerSessionRequest) -> PickerSession:
        normalized = self._validate_payload(payload)
        session = PickerSession(
            sessionId=f"pick_{uuid4().hex[:12]}",
            status="pending",
            url=normalized.url,
            timeoutMs=normalized.timeoutMs,
            headless=normalized.headless,
            createdAt=now_iso(),
            startedAt=None,
            finishedAt=None,
            result=None,
            errorCode=None,
            errorMessage=None,
            diagnostics={},
        )
        picker_repository.save(session)

        cancel_event = Event()
        thread = Thread(
            target=self._run_session,
            args=(session.sessionId, normalized.url, normalized.timeoutMs, normalized.headless, cancel_event),
            daemon=True,
        )
        with self._lock:
            self._runners[session.sessionId] = SessionRunner(cancel_event=cancel_event, thread=thread)
        thread.start()
        return session

    def get_session(self, session_id: str) -> PickerSession:
        session = picker_repository.get(session_id)
        if session is None:
            raise_api_error(
                status_code=404,
                code=PICKER_SESSION_NOT_FOUND,
                message=f"Picker session not found: {session_id}",
                details={"sessionId": session_id},
            )
        return session

    def cancel_session(self, session_id: str) -> PickerSession:
        session = self.get_session(session_id)
        if session.status in TERMINAL_PICKER_STATUS:
            return session

        with self._lock:
            runner = self._runners.get(session_id)
            if runner is not None:
                runner.cancel_event.set()

        cancelled = session.model_copy(
            update={
                "status": "cancelled",
                "finishedAt": now_iso(),
                "errorCode": PICKER_CANCELED,
                "errorMessage": "Picker session cancelled by user.",
            }
        )
        picker_repository.save(cancelled)
        return cancelled

    def stop(self) -> None:
        with self._lock:
            runners = list(self._runners.values())
            for runner in runners:
                runner.cancel_event.set()
        for runner in runners:
            runner.thread.join(timeout=1)
        with self._lock:
            self._runners.clear()

    def _run_session(
        self,
        session_id: str,
        url: str,
        timeout_ms: int,
        headless: bool,
        cancel_event: Event,
    ) -> None:
        session = picker_repository.get(session_id)
        if session is None:
            self._remove_runner(session_id)
            return
        if session.status == "cancelled":
            self._remove_runner(session_id)
            return

        running = session.model_copy(
            update={
                "status": "running",
                "startedAt": now_iso(),
                "errorCode": None,
                "errorMessage": None,
                "diagnostics": {**session.diagnostics, "headless": headless},
            }
        )
        picker_repository.save(running)

        try:
            result = _pick_with_agent(
                url=url,
                timeout_ms=timeout_ms,
                headless=headless,
                should_cancel=cancel_event.is_set,
            )
            latest = picker_repository.get(session_id)
            if latest is None or latest.status == "cancelled":
                return
            succeeded = latest.model_copy(
                update={
                    "status": "succeeded",
                    "finishedAt": now_iso(),
                    "result": result,
                    "errorCode": None,
                    "errorMessage": None,
                }
            )
            picker_repository.save(succeeded)
        except PickerServiceError as exc:
            latest = picker_repository.get(session_id)
            if latest is None:
                return
            if latest.status == "cancelled":
                return
            status = "cancelled" if exc.code == PICKER_CANCELED else "failed"
            failed = latest.model_copy(
                update={
                    "status": status,
                    "finishedAt": now_iso(),
                    "errorCode": exc.code,
                    "errorMessage": exc.message,
                    "diagnostics": {**latest.diagnostics, **exc.details},
                }
            )
            picker_repository.save(failed)
        finally:
            self._remove_runner(session_id)

    def _remove_runner(self, session_id: str) -> None:
        with self._lock:
            self._runners.pop(session_id, None)


picker_runtime = PickerRuntime()


def start_picker_session(payload: StartPickerSessionRequest) -> PickerSession:
    return picker_runtime.start_session(payload)


def get_picker_session(session_id: str) -> PickerSession:
    return picker_runtime.get_session(session_id)


def cancel_picker_session(session_id: str) -> PickerSession:
    return picker_runtime.cancel_session(session_id)


def stop_picker_runtime() -> None:
    picker_runtime.stop()

