from __future__ import annotations

import subprocess
import shutil
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
AGENT_ROOT = ROOT / "apps" / "agent"
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

HAS_AGENT_IMPORT = True
try:
    from agent.runtime.katalon_runner import KatalonRunError, build_katalon_command, run_katalon  # noqa: E402
except ModuleNotFoundError:
    HAS_AGENT_IMPORT = False


@unittest.skipUnless(HAS_AGENT_IMPORT, "agent dependencies are not installed")
class TestKatalonRunner(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.project_dir = ROOT / ".tmp_katalon_project"
        cls.project_dir.mkdir(parents=True, exist_ok=True)

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.project_dir, ignore_errors=True)

    def test_build_command_with_required_fields(self) -> None:
        command = build_katalon_command(
            {
                "command": "katalonc",
                "projectPath": str(self.project_dir),
                "testSuitePath": "Test Suites/Smoke",
                "executionProfile": "default",
                "browserType": "Chrome",
                "consoleLog": True,
            }
        )
        self.assertIn("katalonc", command[0])
        self.assertIn("-testSuitePath=Test Suites/Smoke", command)
        self.assertIn("-executionProfile=default", command)
        self.assertIn("-browserType=Chrome", command)
        self.assertIn("-consoleLog", command)

    def test_run_success_returns_details(self) -> None:
        with patch(
            "agent.runtime.katalon_runner.subprocess.run",
            return_value=subprocess.CompletedProcess(
                args=["katalonc"],
                returncode=0,
                stdout="ok",
                stderr="",
            ),
        ) as mocked:
            result = run_katalon(
                {
                    "command": "katalonc",
                    "projectPath": str(self.project_dir),
                    "testSuitePath": "Test Suites/Smoke",
                },
                timeout_ms=5000,
            )
        mocked.assert_called_once()
        self.assertTrue(result["success"])
        self.assertEqual(result["exitCode"], 0)
        self.assertIn("-testSuitePath=Test Suites/Smoke", result["command"])

    def test_non_zero_exit_raises(self) -> None:
        with patch(
            "agent.runtime.katalon_runner.subprocess.run",
            return_value=subprocess.CompletedProcess(
                args=["katalonc"],
                returncode=1,
                stdout="",
                stderr="failed",
            ),
        ):
            with self.assertRaises(KatalonRunError):
                run_katalon(
                    {
                        "command": "katalonc",
                        "projectPath": str(self.project_dir),
                        "testSuitePath": "Test Suites/Smoke",
                    }
                )


if __name__ == "__main__":
    unittest.main()
