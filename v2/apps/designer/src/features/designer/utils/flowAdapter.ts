import type { FlowModel, NodeType } from "@rpa/flow-schema/generated/types";
import type { Edge as ReactFlowEdge, Node as ReactFlowNode, XYPosition } from "@xyflow/react";

import { normalizeSwitchCaseOptions, readNodePosition, withNodePosition } from "./flow";

export type DesignerNodeData = {
  label: string;
  nodeType: NodeType;
  hasError: boolean;
  config?: Record<string, unknown>;
};

export type DesignerEdgeData = {
  condition?: string;
};

function inferSourceHandle(
  sourceType: NodeType | undefined,
  sourceConfig: Record<string, unknown> | undefined,
  condition: string | undefined
): string | undefined {
  const normalized = (condition || "").trim().toLowerCase();
  if (sourceType === "if") {
    if (normalized === "true") {
      return "if-true";
    }
    if (normalized === "false") {
      return "if-false";
    }
    return undefined;
  }
  if (sourceType === "loop") {
    if (normalized === "body") {
      return "loop-body";
    }
    if (normalized === "exit") {
      return "loop-exit";
    }
    return undefined;
  }
  if (sourceType === "switchCase") {
    const options = normalizeSwitchCaseOptions(sourceConfig?.cases);
    const index = options.findIndex(item => item.toLowerCase() === normalized);
    if (index >= 0) {
      return `switch-case-${index}`;
    }
    return undefined;
  }
  if (sourceType === "rowLocate") {
    if (normalized === "found") {
      return "row-found";
    }
    if (normalized === "notfound") {
      return "row-not-found";
    }
    return undefined;
  }
  return undefined;
}

export function flowToReactFlowNodes(
  flow: FlowModel,
  selectedNodeId: string | null,
  errorNodeIds: string[]
): ReactFlowNode<DesignerNodeData>[] {
  const errorSet = new Set(errorNodeIds);
  return flow.nodes.map((node, index) => {
    const position = readNodePosition(node, index);
    return {
      id: node.id,
      type: "designerNode",
      position: { x: position.x, y: position.y },
      width: 190,
      height: 92,
      style: {
        width: 190,
        minHeight: 92
      },
      selected: node.id === selectedNodeId,
      data: {
        label: node.label ?? "",
        nodeType: node.type,
        hasError: errorSet.has(node.id),
        config: node.config
      }
    };
  });
}

export function flowToReactFlowEdges(
  flow: FlowModel,
  selectedEdgeId: string | null
): ReactFlowEdge<DesignerEdgeData>[] {
  const sourceNodeById = flow.nodes.reduce<Record<string, { type: NodeType; config: Record<string, unknown> }>>(
    (acc, node) => {
      acc[node.id] = { type: node.type, config: node.config };
      return acc;
    },
    {}
  );
  return flow.edges.map(edge => {
    const source = sourceNodeById[edge.source];
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: inferSourceHandle(source?.type, source?.config, edge.condition),
      selected: edge.id === selectedEdgeId,
      type: "designerEdge",
      data: {
        condition: edge.condition
      }
    };
  });
}

export function applyReactFlowPositionsToFlow(
  flow: FlowModel,
  positions: Array<{ id: string; position: XYPosition }>
): FlowModel {
  const nextById = new Map(positions.map(item => [item.id, item.position] as const));
  return {
    ...flow,
    nodes: flow.nodes.map((node, index) => {
      const position = nextById.get(node.id);
      if (!position) {
        return node;
      }
      const fallback = readNodePosition(node, index);
      const x = Number.isFinite(position.x) ? position.x : fallback.x;
      const y = Number.isFinite(position.y) ? position.y : fallback.y;
      return {
        ...node,
        config: withNodePosition(node.config, { x, y })
      };
    })
  };
}
