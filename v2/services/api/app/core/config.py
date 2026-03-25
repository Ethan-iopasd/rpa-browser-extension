from __future__ import annotations

import os
from pathlib import Path


class Settings:
    app_name: str = "RPA Flow API"
    app_version: str = "0.5.0"
    api_prefix: str = "/api/v1"

    def cors_origins(self) -> list[str]:
        value = os.getenv("RPA_API_CORS_ORIGINS", "")
        if not value:
            return [
                "http://127.0.0.1:5173",
                "http://localhost:5173",
                "tauri://localhost",
                "http://tauri.localhost",
                "https://tauri.localhost",
            ]
        return [item.strip() for item in value.split(",") if item.strip()]

    def scheduler_enabled(self) -> bool:
        value = os.getenv("RPA_TASK_SCHEDULER_ENABLED", "1")
        return value not in {"0", "false", "False"}

    def scheduler_poll_interval_seconds(self) -> float:
        value = os.getenv("RPA_TASK_SCHEDULER_POLL_SECONDS", "1.0")
        try:
            parsed = float(value)
        except ValueError:
            return 1.0
        return min(max(parsed, 0.2), 10.0)

    def max_concurrency(self) -> int:
        value = os.getenv("RPA_RUN_MAX_CONCURRENCY", "2")
        try:
            parsed = int(value)
        except ValueError:
            return 2
        return min(max(parsed, 1), 32)

    def runtime_dir(self) -> Path:
        override = os.getenv("RPA_RUNTIME_DIR")
        if override:
            return Path(override)
        return Path(__file__).resolve().parents[2] / ".runtime"

    def failures_alert_threshold(self) -> int:
        value = os.getenv("RPA_ALERT_FAILURE_THRESHOLD", "3")
        try:
            parsed = int(value)
        except ValueError:
            return 3
        return min(max(parsed, 1), 1000)

    def credential_key(self) -> str:
        value = os.getenv("RPA_CREDENTIAL_KEY", "")
        return value.strip()


settings = Settings()
