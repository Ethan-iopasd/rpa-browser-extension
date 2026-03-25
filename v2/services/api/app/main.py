from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.errors import build_api_error
from app.routers.flows import router as flows_router
from app.routers.health import router as health_router
from app.routers.native_picker import router as native_picker_router
from app.routers.picker import router as picker_router
from app.routers.runs import router as runs_router
from app.routers.security import router as security_router
from app.routers.tasks import router as tasks_router
from app.services.native_picker_service import stop_native_picker_runtime
from app.services.picker_service import stop_picker_runtime
from app.services.task_service import start_runtime, stop_runtime


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """应用生命周期管理：启动调度运行时，关闭时优雅停止。"""
    start_runtime()
    try:
        yield
    finally:
        stop_runtime()
        stop_picker_runtime()
        stop_native_picker_runtime()


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=build_api_error(
                code="REQUEST_VALIDATION_FAILED",
                message="Request payload validation failed.",
                details={"errors": exc.errors()},
            ),
        )

    @app.exception_handler(HTTPException)
    async def handle_http_exception(_: Request, exc: HTTPException) -> JSONResponse:
        if isinstance(exc.detail, dict) and {"code", "message", "requestId"} <= set(exc.detail.keys()):
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        return JSONResponse(
            status_code=exc.status_code,
            content=build_api_error(
                code="HTTP_ERROR",
                message=str(exc.detail),
            ),
        )

    app.include_router(health_router, prefix=settings.api_prefix)
    app.include_router(flows_router, prefix=settings.api_prefix)
    app.include_router(runs_router, prefix=settings.api_prefix)
    app.include_router(tasks_router, prefix=settings.api_prefix)
    app.include_router(security_router, prefix=settings.api_prefix)
    app.include_router(picker_router, prefix=settings.api_prefix)
    app.include_router(native_picker_router, prefix=settings.api_prefix)

    return app


app = create_app()

