from __future__ import annotations

from uuid import uuid4

from agent.models.contracts import FlowModel, RunEvent, RunResult, now_iso


def execute_stub(flow: FlowModel) -> RunResult:
    run_id = f"run_{uuid4().hex[:12]}"
    started_at = now_iso()
    events: list[RunEvent] = []

    for node in flow.nodes:
        events.append(
            RunEvent(
                eventId=f"evt_{uuid4().hex[:12]}",
                timestamp=now_iso(),
                runId=run_id,
                nodeId=node.id,
                nodeType=node.type,
                level="info",
                message=f"Executed node {node.type} in agent stub.",
                durationMs=10,
                data={"stub": True},
            )
        )

    return RunResult(
        runId=run_id,
        flowId=flow.id,
        status="success",
        startedAt=started_at,
        finishedAt=now_iso(),
        events=events,
    )
