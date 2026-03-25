from __future__ import annotations

from dataclasses import dataclass

from agent.models.contracts import FLOW_SCHEMA_VERSION, FlowModel
from agent.models.error_codes import UNSUPPORTED_SCHEMA_VERSION


@dataclass(slots=True)
class FlowMigrationError(Exception):
    code: str
    message: str
    details: dict[str, object]

    def __str__(self) -> str:
        return self.message


def migrate_flow(flow: FlowModel) -> FlowModel:
    if flow.schemaVersion == FLOW_SCHEMA_VERSION:
        return flow
    raise FlowMigrationError(
        code=UNSUPPORTED_SCHEMA_VERSION,
        message=(
            f"Unsupported schemaVersion: {flow.schemaVersion}. "
            f"Current runtime supports {FLOW_SCHEMA_VERSION}."
        ),
        details={"schemaVersion": flow.schemaVersion, "supported": [FLOW_SCHEMA_VERSION]},
    )
