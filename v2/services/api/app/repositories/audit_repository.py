from __future__ import annotations

from threading import Lock

from app.core.config import settings
from app.repositories.json_store import JsonStore
from app.schemas.contracts import AuditRecord


class AuditRepository:
    def __init__(self) -> None:
        self._lock = Lock()
        self._store = JsonStore(settings.runtime_dir() / "audit_logs.json")
        self._records: list[AuditRecord] = []
        self._max_records = 20_000
        self._load()

    def _load(self) -> None:
        payload = self._store.load()
        for item in payload:
            try:
                record = AuditRecord.model_validate(item)
            except Exception:
                continue
            self._records.append(record)

    def _persist(self) -> None:
        self._store.save([item.model_dump() for item in self._records])

    def append(self, record: AuditRecord) -> None:
        with self._lock:
            self._records.append(record)
            if len(self._records) > self._max_records:
                self._records = self._records[-self._max_records :]
            self._persist()

    def list(self, limit: int = 100, offset: int = 0) -> tuple[int, list[AuditRecord]]:
        with self._lock:
            total = len(self._records)
            items = list(reversed(self._records))
        return total, items[offset : offset + limit]

    def clear(self) -> None:
        with self._lock:
            self._records = []
            self._persist()


audit_repository = AuditRepository()
