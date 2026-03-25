from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class NodeExecutionError(Exception):
    code: str
    message: str
    details: dict[str, object]

    def __str__(self) -> str:
        return self.message
