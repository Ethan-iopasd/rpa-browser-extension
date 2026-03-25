from __future__ import annotations

from threading import Lock
from typing import Any

from app.core.config import settings
from app.repositories.json_store import JsonStore


class CredentialRepository:
    def __init__(self) -> None:
        self._lock = Lock()
        self._store = JsonStore(settings.runtime_dir() / "credentials.json")
        self._items: dict[str, dict[str, Any]] = {}
        self._order: list[str] = []
        self._load()

    def _load(self) -> None:
        for item in self._store.load():
            credential_id = item.get("credentialId")
            if not isinstance(credential_id, str):
                continue
            self._items[credential_id] = item
            self._order.append(credential_id)

    def _persist(self) -> None:
        payload = [self._items[item] for item in self._order if item in self._items]
        self._store.save(payload)

    def save(self, payload: dict[str, Any]) -> None:
        credential_id = payload.get("credentialId")
        if not isinstance(credential_id, str):
            raise ValueError("credentialId is required")
        with self._lock:
            if credential_id not in self._items:
                self._order.append(credential_id)
            self._items[credential_id] = payload
            self._persist()

    def get(self, credential_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self._items.get(credential_id)

    def list(self, limit: int = 100, offset: int = 0) -> tuple[int, list[dict[str, Any]]]:
        with self._lock:
            ordered = [self._items[item] for item in self._order if item in self._items]
        ordered.reverse()
        total = len(ordered)
        return total, ordered[offset : offset + limit]

    def clear(self) -> None:
        with self._lock:
            self._items = {}
            self._order = []
            self._persist()


credential_repository = CredentialRepository()
