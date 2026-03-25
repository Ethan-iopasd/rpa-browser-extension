from __future__ import annotations

import json
import os
import struct
import sys
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.schemas.native_picker_protocol import NativePickerMessageEnvelope
from app.services.native_picker_service import handle_native_picker_message


def _native_host_log_path() -> Path:
    return settings.runtime_dir() / "native_picker_host.log"


def _write_log(message: str) -> None:
    if os.getenv("RPA_NATIVE_PICKER_HOST_LOG", "0") in {"0", "false", "False", "no", "NO"}:
        return
    path = _native_host_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"{message}\n")


def _read_native_message(stream: Any) -> dict[str, Any] | None:
    length_bytes = stream.read(4)
    if not length_bytes:
        return None
    if len(length_bytes) < 4:
        raise ValueError("Invalid native message length header.")
    length = struct.unpack("<I", length_bytes)[0]
    if length <= 0 or length > 10_000_000:
        raise ValueError(f"Invalid native message length: {length}")
    payload = stream.read(length)
    if len(payload) != length:
        raise ValueError("Native message body truncated.")
    decoded = payload.decode("utf-8", errors="strict")
    loaded = json.loads(decoded)
    if not isinstance(loaded, dict):
        raise ValueError("Native message payload must be a JSON object.")
    return loaded


def _write_native_message(stream: Any, payload: dict[str, Any]) -> None:
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    stream.write(struct.pack("<I", len(encoded)))
    stream.write(encoded)
    stream.flush()


def run_native_host_loop() -> None:
    allowed_extensions = {
        item.strip()
        for item in os.getenv("RPA_NATIVE_PICKER_ALLOWED_EXTENSIONS", "").split(",")
        if item.strip()
    }
    _write_log("native host started")

    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer

    while True:
        try:
            message = _read_native_message(stdin)
            if message is None:
                _write_log("native host received EOF and exits")
                return

            sender_extension_id = str(message.get("senderExtensionId", "")).strip()
            if allowed_extensions and sender_extension_id and sender_extension_id not in allowed_extensions:
                ack = {
                    "schemaVersion": "native-picker.v1",
                    "ok": False,
                    "code": "NATIVE_PICKER_HOST_UNAUTHORIZED",
                    "message": "senderExtensionId is not in allowed list.",
                    "details": {"senderExtensionId": sender_extension_id},
                }
                _write_native_message(stdout, ack)
                _write_log(f"unauthorized senderExtensionId={sender_extension_id}")
                continue

            envelope = NativePickerMessageEnvelope.model_validate(message)
            ack = handle_native_picker_message(envelope, source="native_host")
            _write_native_message(stdout, ack.model_dump(mode="json", exclude_none=True))
        except Exception as exc:  # pragma: no cover - runtime dependent
            _write_log(f"native host error: {exc}")
            fallback = {
                "schemaVersion": "native-picker.v1",
                "ok": False,
                "code": "NATIVE_PICKER_HOST_ERROR",
                "message": str(exc),
                "details": {},
            }
            try:
                _write_native_message(stdout, fallback)
            except Exception:
                return


def main() -> None:
    run_native_host_loop()


if __name__ == "__main__":
    main()
