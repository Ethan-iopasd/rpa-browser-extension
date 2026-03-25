from __future__ import annotations

from threading import Lock

from app.core.config import settings
from app.repositories.json_store import JsonStore
from app.schemas.contracts import PickerSession


class PickerRepository:
    def __init__(self) -> None:
        self._lock = Lock()
        self._sessions: dict[str, PickerSession] = {}
        self._order: list[str] = []
        self._store = JsonStore(settings.runtime_dir() / "picker_sessions.json")
        self._max_records = 2_000
        self._load()

    def _load(self) -> None:
        payload = self._store.load()
        for item in payload:
            try:
                model = PickerSession.model_validate(item)
            except Exception:
                continue
            self._sessions[model.sessionId] = model
            self._order.append(model.sessionId)

    def _persist(self) -> None:
        ordered = [self._sessions[item].model_dump() for item in self._order if item in self._sessions]
        self._store.save(ordered)

    def save(self, session: PickerSession) -> PickerSession:
        with self._lock:
            if session.sessionId not in self._sessions:
                self._order.append(session.sessionId)
            self._sessions[session.sessionId] = session
            while len(self._order) > self._max_records:
                oldest = self._order.pop(0)
                self._sessions.pop(oldest, None)
            self._persist()
            return session

    def get(self, session_id: str) -> PickerSession | None:
        with self._lock:
            return self._sessions.get(session_id)

    def list(self, *, limit: int = 50, offset: int = 0) -> tuple[int, list[PickerSession]]:
        with self._lock:
            records = [self._sessions[item] for item in self._order if item in self._sessions]
        records.sort(key=lambda item: item.createdAt, reverse=True)
        total = len(records)
        return total, records[offset : offset + limit]

    def clear(self) -> None:
        with self._lock:
            self._sessions.clear()
            self._order.clear()
            self._persist()


picker_repository = PickerRepository()

