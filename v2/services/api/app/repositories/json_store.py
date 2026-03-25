from __future__ import annotations

import json
from pathlib import Path
from threading import Lock
from typing import Any


class JsonStore:
    def __init__(self, file_path: Path) -> None:
        self._file_path = file_path
        self._lock = Lock()
        self._file_path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> list[dict[str, Any]]:
        with self._lock:
            if not self._file_path.exists():
                return []
            raw = self._file_path.read_text(encoding="utf-8")
            if not raw.strip():
                return []
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                return []
            if isinstance(payload, list):
                return [item for item in payload if isinstance(item, dict)]
            return []

    def save(self, payload: list[dict[str, Any]]) -> None:
        with self._lock:
            tmp_path = self._file_path.with_suffix(".tmp")
            tmp_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            tmp_path.replace(self._file_path)
