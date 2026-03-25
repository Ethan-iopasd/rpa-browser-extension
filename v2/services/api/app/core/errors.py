from __future__ import annotations

from typing import NoReturn
from typing import Any
from uuid import uuid4

from fastapi import HTTPException


def new_request_id() -> str:
    return f"req_{uuid4().hex[:12]}"


def build_api_error(
    *,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "details": details or {},
        "requestId": request_id or new_request_id(),
    }


def raise_api_error(
    *,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> NoReturn:
    raise HTTPException(
        status_code=status_code,
        detail=build_api_error(code=code, message=message, details=details),
    )
