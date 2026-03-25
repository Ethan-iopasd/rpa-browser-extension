from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from threading import Lock

from app.core.config import settings
from app.schemas.native_picker_protocol import (
    NativePickerEvent,
    NativePickerResultRecord,
    NativePickerSession,
)


class NativePickerRepository:
    def __init__(self) -> None:
        self._lock = Lock()
        self._db_path = settings.runtime_dir() / "native_picker.sqlite3"
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self._db_path), timeout=8.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute("PRAGMA busy_timeout=5000")
        return connection

    def _init_db(self) -> None:
        with self._lock:
            with self._connect() as connection:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS native_picker_sessions (
                        session_id TEXT PRIMARY KEY,
                        status TEXT NOT NULL,
                        node_id TEXT NOT NULL,
                        page_url TEXT NOT NULL,
                        launch_mode TEXT NOT NULL DEFAULT 'attach_existing',
                        timeout_ms INTEGER NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        expires_at TEXT,
                        finished_at TEXT,
                        requested_by TEXT,
                        source TEXT NOT NULL,
                        error_code TEXT,
                        error_message TEXT,
                        diagnostics_json TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS native_picker_events (
                        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        session_id TEXT NOT NULL,
                        event_type TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        source TEXT NOT NULL,
                        payload_json TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS native_picker_results (
                        session_id TEXT PRIMARY KEY,
                        created_at TEXT NOT NULL,
                        consumed_at TEXT,
                        source TEXT NOT NULL,
                        payload_json TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS idx_native_picker_sessions_status ON native_picker_sessions(status)"
                )
                columns = {
                    str(row["name"])
                    for row in connection.execute("PRAGMA table_info(native_picker_sessions)").fetchall()
                }
                if "launch_mode" not in columns:
                    connection.execute(
                        "ALTER TABLE native_picker_sessions ADD COLUMN launch_mode TEXT NOT NULL DEFAULT 'attach_existing'"
                    )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS idx_native_picker_events_session ON native_picker_events(session_id, event_id DESC)"
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS idx_native_picker_results_consumed ON native_picker_results(consumed_at, created_at)"
                )

    @staticmethod
    def _row_to_session(row: sqlite3.Row) -> NativePickerSession:
        diagnostics_raw = row["diagnostics_json"] or "{}"
        diagnostics = json.loads(diagnostics_raw) if isinstance(diagnostics_raw, str) else {}
        return NativePickerSession.model_validate(
            {
                "sessionId": row["session_id"],
                "status": row["status"],
                "nodeId": row["node_id"],
                "pageUrl": row["page_url"],
                "launchMode": row["launch_mode"] or "attach_existing",
                "timeoutMs": int(row["timeout_ms"]),
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
                "expiresAt": row["expires_at"],
                "finishedAt": row["finished_at"],
                "requestedBy": row["requested_by"],
                "source": row["source"],
                "errorCode": row["error_code"],
                "errorMessage": row["error_message"],
                "diagnostics": diagnostics if isinstance(diagnostics, dict) else {},
            }
        )

    def save_session(self, session: NativePickerSession) -> NativePickerSession:
        with self._lock:
            with self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO native_picker_sessions (
                        session_id, status, node_id, page_url, launch_mode, timeout_ms, created_at, updated_at,
                        expires_at, finished_at, requested_by, source, error_code, error_message, diagnostics_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(session_id) DO UPDATE SET
                        status = excluded.status,
                        node_id = excluded.node_id,
                        page_url = excluded.page_url,
                        launch_mode = excluded.launch_mode,
                        timeout_ms = excluded.timeout_ms,
                        created_at = excluded.created_at,
                        updated_at = excluded.updated_at,
                        expires_at = excluded.expires_at,
                        finished_at = excluded.finished_at,
                        requested_by = excluded.requested_by,
                        source = excluded.source,
                        error_code = excluded.error_code,
                        error_message = excluded.error_message,
                        diagnostics_json = excluded.diagnostics_json
                    """,
                    (
                        session.sessionId,
                        session.status,
                        session.nodeId,
                        session.pageUrl,
                        session.launchMode,
                        int(session.timeoutMs),
                        session.createdAt,
                        session.updatedAt,
                        session.expiresAt,
                        session.finishedAt,
                        session.requestedBy,
                        session.source,
                        session.errorCode,
                        session.errorMessage,
                        json.dumps(session.diagnostics, ensure_ascii=False),
                    ),
                )
        return session

    def get_session(self, session_id: str) -> NativePickerSession | None:
        with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    """
                    SELECT
                        session_id, status, node_id, page_url, timeout_ms, created_at, updated_at, expires_at,
                        finished_at, requested_by, source, error_code, error_message, diagnostics_json, launch_mode
                    FROM native_picker_sessions
                    WHERE session_id = ?
                    """,
                    (session_id,),
                ).fetchone()
        if row is None:
            return None
        return self._row_to_session(row)

    def list_sessions(self, *, limit: int = 50, offset: int = 0) -> tuple[int, list[NativePickerSession]]:
        safe_limit = min(max(int(limit), 1), 500)
        safe_offset = max(int(offset), 0)
        with self._lock:
            with self._connect() as connection:
                total = int(connection.execute("SELECT COUNT(*) AS count FROM native_picker_sessions").fetchone()["count"])
                rows = connection.execute(
                    """
                    SELECT
                        session_id, status, node_id, page_url, timeout_ms, created_at, updated_at, expires_at,
                        finished_at, requested_by, source, error_code, error_message, diagnostics_json, launch_mode
                    FROM native_picker_sessions
                    ORDER BY created_at DESC
                    LIMIT ? OFFSET ?
                    """,
                    (safe_limit, safe_offset),
                ).fetchall()
        return total, [self._row_to_session(row) for row in rows]

    def save_event(self, event: NativePickerEvent) -> NativePickerEvent:
        with self._lock:
            with self._connect() as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO native_picker_events (session_id, event_type, created_at, source, payload_json)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        event.sessionId,
                        event.eventType,
                        event.createdAt,
                        event.source,
                        json.dumps(event.payload, ensure_ascii=False),
                    ),
                )
                event_id = int(cursor.lastrowid)
        return event.model_copy(update={"eventId": event_id})

    def list_events(self, session_id: str, *, limit: int = 100) -> list[NativePickerEvent]:
        safe_limit = min(max(int(limit), 1), 500)
        with self._lock:
            with self._connect() as connection:
                rows = connection.execute(
                    """
                    SELECT event_id, session_id, event_type, created_at, source, payload_json
                    FROM native_picker_events
                    WHERE session_id = ?
                    ORDER BY event_id DESC
                    LIMIT ?
                    """,
                    (session_id, safe_limit),
                ).fetchall()
        events: list[NativePickerEvent] = []
        for row in rows:
            payload_raw = row["payload_json"] or "{}"
            payload = json.loads(payload_raw) if isinstance(payload_raw, str) else {}
            events.append(
                NativePickerEvent.model_validate(
                    {
                        "eventId": int(row["event_id"]),
                        "sessionId": row["session_id"],
                        "eventType": row["event_type"],
                        "createdAt": row["created_at"],
                        "source": row["source"],
                        "payload": payload if isinstance(payload, dict) else {},
                    }
                )
            )
        return events

    def save_result(self, record: NativePickerResultRecord) -> NativePickerResultRecord:
        with self._lock:
            with self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO native_picker_results (session_id, created_at, consumed_at, source, payload_json)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(session_id) DO UPDATE SET
                        created_at = excluded.created_at,
                        consumed_at = excluded.consumed_at,
                        source = excluded.source,
                        payload_json = excluded.payload_json
                    """,
                    (
                        record.sessionId,
                        record.createdAt,
                        record.consumedAt,
                        record.source,
                        json.dumps(record.result.model_dump(mode="json"), ensure_ascii=False),
                    ),
                )
        return record

    def pull_result(self, *, session_id: str | None = None, consumed_at: str | None = None) -> NativePickerResultRecord | None:
        with self._lock:
            with self._connect() as connection:
                if session_id:
                    row = connection.execute(
                        """
                        SELECT session_id, created_at, consumed_at, source, payload_json
                        FROM native_picker_results
                        WHERE session_id = ? AND consumed_at IS NULL
                        LIMIT 1
                        """,
                        (session_id,),
                    ).fetchone()
                else:
                    row = connection.execute(
                        """
                        SELECT session_id, created_at, consumed_at, source, payload_json
                        FROM native_picker_results
                        WHERE consumed_at IS NULL
                        ORDER BY created_at ASC
                        LIMIT 1
                        """
                    ).fetchone()
                if row is None:
                    return None
                now_value = consumed_at or row["consumed_at"]
                connection.execute(
                    "UPDATE native_picker_results SET consumed_at = ? WHERE session_id = ?",
                    (now_value, row["session_id"]),
                )

        payload_raw = row["payload_json"] or "{}"
        payload = json.loads(payload_raw) if isinstance(payload_raw, str) else {}
        return NativePickerResultRecord.model_validate(
            {
                "sessionId": row["session_id"],
                "createdAt": row["created_at"],
                "consumedAt": now_value,
                "source": row["source"],
                "result": payload,
            }
        )

    def clear(self) -> None:
        with self._lock:
            with self._connect() as connection:
                connection.execute("DELETE FROM native_picker_results")
                connection.execute("DELETE FROM native_picker_events")
                connection.execute("DELETE FROM native_picker_sessions")


native_picker_repository = NativePickerRepository()
