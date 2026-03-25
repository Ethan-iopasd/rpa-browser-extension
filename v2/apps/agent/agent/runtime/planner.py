from __future__ import annotations

from dataclasses import dataclass

from agent.models.contracts import FlowEdge, FlowModel, FlowNode
from agent.models.error_codes import FLOW_VALIDATION_FAILED


@dataclass(slots=True)
class PlanningError(Exception):
    code: str
    message: str
    details: dict[str, object]

    def __str__(self) -> str:
        return self.message


@dataclass(slots=True)
class ExecutionPlan:
    start_node_id: str
    node_by_id: dict[str, FlowNode]
    outgoing_by_node: dict[str, list[FlowEdge]]
    incoming_by_node: dict[str, list[FlowEdge]]

    def outgoing(self, node_id: str) -> list[FlowEdge]:
        return self.outgoing_by_node.get(node_id, [])

    def incoming(self, node_id: str) -> list[FlowEdge]:
        return self.incoming_by_node.get(node_id, [])


def build_plan(flow: FlowModel) -> ExecutionPlan:
    node_by_id: dict[str, FlowNode] = {}
    for node in flow.nodes:
        if node.id in node_by_id:
            raise PlanningError(
                code=FLOW_VALIDATION_FAILED,
                message=f"Duplicate node id found: {node.id}",
                details={"nodeId": node.id},
            )
        node_by_id[node.id] = node

    start_nodes = [node.id for node in flow.nodes if node.type == "start"]
    if len(start_nodes) != 1:
        raise PlanningError(
            code=FLOW_VALIDATION_FAILED,
            message="Flow must contain exactly one start node.",
            details={"startCount": len(start_nodes)},
        )

    outgoing_by_node: dict[str, list[FlowEdge]] = {node_id: [] for node_id in node_by_id}
    incoming_by_node: dict[str, list[FlowEdge]] = {node_id: [] for node_id in node_by_id}
    seen_edge_ids: set[str] = set()

    for edge in flow.edges:
        if edge.id in seen_edge_ids:
            raise PlanningError(
                code=FLOW_VALIDATION_FAILED,
                message=f"Duplicate edge id found: {edge.id}",
                details={"edgeId": edge.id},
            )
        seen_edge_ids.add(edge.id)

        if edge.source not in node_by_id or edge.target not in node_by_id:
            raise PlanningError(
                code=FLOW_VALIDATION_FAILED,
                message=f"Edge {edge.id} references missing node.",
                details={"edgeId": edge.id, "source": edge.source, "target": edge.target},
            )
        outgoing_by_node[edge.source].append(edge)
        incoming_by_node[edge.target].append(edge)

    for edges in outgoing_by_node.values():
        edges.sort(key=lambda item: item.id)

    return ExecutionPlan(
        start_node_id=start_nodes[0],
        node_by_id=node_by_id,
        outgoing_by_node=outgoing_by_node,
        incoming_by_node=incoming_by_node,
    )
