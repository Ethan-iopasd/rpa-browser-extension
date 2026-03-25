"""
Run Event Broadcaster — 发布/订阅机制，用于通过 WebSocket 实时推送运行事件。

设计思路：
- 执行引擎完成某个 run 后，调用 `broadcast_run_done(run_id, events)` 推送全量事件列表。
- 前端通过 WebSocket 连接到 `/ws/runs/{run_id}`：
  - 若 run 已完成，立即发送全量事件并关闭连接。
  - 若 run 正在进行，等待 broadcaster 推送后再发送。
- 该模块不依赖任何持久化，重启后订阅者清空。
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from threading import Lock
from typing import Any


class RunBroadcaster:
    """线程安全的运行事件广播中心。"""

    def __init__(self) -> None:
        self._lock = Lock()
        # run_id -> list of asyncio.Queue 等待者
        self._waiters: dict[str, list[asyncio.Queue[list[dict[str, Any]]]]] = defaultdict(list)

    def subscribe(self, run_id: str) -> asyncio.Queue[list[dict[str, Any]]]:
        """订阅某个 run 的完成事件，返回一个 asyncio Queue。"""
        queue: asyncio.Queue[list[dict[str, Any]]] = asyncio.Queue(maxsize=1)
        with self._lock:
            self._waiters[run_id].append(queue)
        return queue

    def unsubscribe(self, run_id: str, queue: asyncio.Queue[list[dict[str, Any]]]) -> None:
        """取消订阅。"""
        with self._lock:
            waiters = self._waiters.get(run_id, [])
            try:
                waiters.remove(queue)
            except ValueError:
                pass
            if not waiters:
                self._waiters.pop(run_id, None)

    def broadcast_run_done(self, run_id: str, events: list[dict[str, Any]]) -> None:
        """
        在 run 完成后调用，向所有等待该 run 的订阅者推送事件列表。
        可在普通线程中安全调用（内部使用 call_soon_threadsafe）。
        """
        with self._lock:
            waiters = self._waiters.pop(run_id, [])

        for queue in waiters:
            try:
                loop = queue._loop  # type: ignore[attr-defined]
                if loop is not None and loop.is_running():
                    loop._call_soon_threadsafe(queue.put_nowait, events)
            except Exception:
                pass


run_broadcaster = RunBroadcaster()
