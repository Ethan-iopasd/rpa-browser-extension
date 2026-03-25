# RPA Flow Desktop (Stage 2)

This package hosts the desktop shell for RPA Flow V2 using Tauri.

## Commands

1. `pnpm --filter @rpa/desktop dev:tauri` - run desktop shell and load Designer dev server.
2. `pnpm --filter @rpa/desktop build:tauri` - build desktop package using Designer production assets.
3. `pnpm --filter @rpa/desktop dev:designer` - run Designer dev server only.
4. `pnpm --filter @rpa/desktop build:designer` - build Designer assets only.

## Stage 1 Behavior

1. Desktop window loads Designer directly.
2. API service is started automatically on app setup.
3. API process spawned by desktop shell is stopped when window closes.
4. API CORS defaults include Tauri origins for packaged mode.

## Stage 2 Behavior (Current)

1. API supervision loop runs every 2 seconds.
2. If API health fails continuously, desktop shell applies exponential backoff and auto-restarts API.
3. Auto-restart has a max-attempt guard to avoid infinite restart loops.
4. Runtime status now exposes restart count, failure count, and last health check timestamp.
5. Desktop commands now support service restart and diagnostics export.
6. Agent readiness probe runs periodically and updates health counters.
7. Diagnostics export now includes runtime log summaries (runs/tasks/audit).
8. Release metadata command exposes desktop version and installer bundle path.

## Notes

1. Desktop shell uses a dedicated local API port (default `18080`) to avoid conflicts with dev API (`8000`).
2. You can set preferred port by environment variable `RPA_DESKTOP_API_PORT`.
3. If preferred port is occupied, desktop shell automatically switches to the next available port.
4. Agent process supervision is planned for the next Stage 2 iteration.
5. Cargo network access is configured via `src-tauri/.cargo/config.toml` to use the local proxy `127.0.0.1:7897`.
