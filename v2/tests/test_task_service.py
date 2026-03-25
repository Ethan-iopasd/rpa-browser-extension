from __future__ import annotations

import json
import os
import sys
import unittest
from datetime import timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ["RPA_RUNTIME_DIR"] = str(ROOT / ".test_runtime")
os.environ["RPA_TASK_SCHEDULER_ENABLED"] = "0"
API_ROOT = ROOT / "services" / "api"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))
AGENT_ROOT = ROOT / "apps" / "agent"
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

HAS_IMPORT = True
try:
    from app.repositories.run_repository import run_repository  # noqa: E402
    from app.repositories.task_repository import task_repository  # noqa: E402
    from app.schemas.contracts import CreateTaskRequest, FlowModel, TaskSchedule, parse_iso  # noqa: E402
    from app.services.task_service import (  # noqa: E402
        create_task,
        delete_task,
        execute_task_now,
        preview_schedule,
        trigger_task,
    )
except ModuleNotFoundError:
    HAS_IMPORT = False


@unittest.skipUnless(HAS_IMPORT, "api or agent dependencies are not installed")
class TestTaskService(unittest.TestCase):
    def setUp(self) -> None:
        run_repository.clear()
        task_repository.clear()

    def _load_minimal_flow(self) -> FlowModel:
        flow_path = ROOT / "packages" / "flow-schema" / "examples" / "minimal.flow.json"
        payload = json.loads(flow_path.read_text(encoding="utf-8"))
        return FlowModel.model_validate(payload)

    def test_create_interval_task_and_execute(self) -> None:
        flow = self._load_minimal_flow()
        task = create_task(
            CreateTaskRequest(
                name="demo schedule",
                type="scheduled",
                flow=flow,
                schedule=TaskSchedule(mode="interval", intervalSeconds=60),
            )
        )
        self.assertEqual(task.type, "scheduled")
        execute_task_now(task.taskId, trigger_type="scheduled")
        total, runs = run_repository.list(task_id=task.taskId, limit=10, offset=0)
        self.assertGreaterEqual(total, 1)
        self.assertEqual(runs[0].taskId, task.taskId)

    def test_trigger_task_queues(self) -> None:
        flow = self._load_minimal_flow()
        task = create_task(
            CreateTaskRequest(
                name="manual queue",
                type="manual",
                flow=flow,
            )
        )
        result = trigger_task(task.taskId, trigger_type="manual")
        self.assertEqual(result.taskId, task.taskId)
        self.assertEqual(result.queuedRuns, 1)

    def test_invalid_flow_generates_failed_run(self) -> None:
        flow = self._load_minimal_flow()
        flow.nodes = [node for node in flow.nodes if node.type != "start"]
        task = create_task(
            CreateTaskRequest(
                name="invalid flow task",
                type="manual",
                flow=flow,
            )
        )
        execute_task_now(task.taskId, trigger_type="manual")
        total, runs = run_repository.list(task_id=task.taskId, limit=10, offset=0)
        self.assertGreaterEqual(total, 1)
        self.assertEqual(runs[0].status, "failed")

    def test_create_daily_task_has_future_next_run(self) -> None:
        flow = self._load_minimal_flow()
        task = create_task(
            CreateTaskRequest(
                name="daily schedule",
                type="scheduled",
                flow=flow,
                schedule=TaskSchedule(mode="daily", timezone="UTC", timeOfDay="23:59"),
            )
        )
        self.assertIsNotNone(task.nextRunAt)
        next_run = parse_iso(task.nextRunAt)
        self.assertIsNotNone(next_run)
        self.assertEqual(task.schedule.mode, "daily")

    def test_preview_weekly_schedule_returns_multiple_runs(self) -> None:
        result = preview_schedule(
            TaskSchedule(mode="weekly", timezone="UTC", timeOfDay="08:30", weekdays=["mon", "wed"]),
            count=3,
        )
        self.assertEqual(result.total, 3)
        self.assertEqual(len(result.nextRuns), 3)
        for item in result.nextRuns:
            dt = parse_iso(item)
            self.assertIsNotNone(dt)
            self.assertEqual(dt.tzinfo, timezone.utc)

    def test_delete_task_removes_record(self) -> None:
        flow = self._load_minimal_flow()
        task = create_task(
            CreateTaskRequest(
                name="to be deleted",
                type="manual",
                flow=flow,
            )
        )
        deleted = delete_task(task.taskId)
        self.assertEqual(deleted.taskId, task.taskId)
        self.assertIsNone(task_repository.get(task.taskId))


if __name__ == "__main__":
    unittest.main()
