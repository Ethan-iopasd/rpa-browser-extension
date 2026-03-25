import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FlowModel, NodeType } from "@rpa/flow-schema/generated/types";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  getBezierPath,
  type Connection,
  type Edge as ReactFlowEdge,
  type EdgeProps,
  type NodeChange,
  type Node as ReactFlowNode,
  type NodeProps,
  type ReactFlowInstance
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { NodeCanvasPosition } from "../utils/flow";
import { AddNodeMenu } from "./AddNodeMenu";
import { getNodeTypeLabel, normalizeSwitchCaseOptions, readNodePosition } from "../utils/flow";
import { getNodeOutputSpecs, buildVariableRef } from "../utils/nodeOutputs";

type NodeMenuState = {
  type: "source" | "edge" | "canvas";
  targetId?: string;
  position: { x: number; y: number };
};
import {
  flowToReactFlowEdges,
  flowToReactFlowNodes,
  type DesignerEdgeData,
  type DesignerNodeData
} from "../utils/flowAdapter";

type ReactFlowCanvasProps = {
  flow: FlowModel;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  errorNodeIds: string[];
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onAddNode: (type: NodeType, position?: NodeCanvasPosition) => void;
  onAddNodeFromSource: (sourceNodeId: string, type: NodeType, position?: NodeCanvasPosition) => void;
  onInsertNodeOnEdge: (edgeId: string, type: NodeType) => void;
  onRemoveNode: (nodeId: string) => void;
  onAddEdge: (source: string, target: string, condition?: string) => void;
  onUpdateNodePosition: (nodeId: string, x: number, y: number) => void;
};

type DesignerNodeRenderData = DesignerNodeData & {
  onRequestAddFromSource: (nodeId: string, clientX: number, clientY: number) => void;
  onRequestRemoveNode: (nodeId: string) => void;
};

type DesignerEdgeRenderData = DesignerEdgeData & {
  onRequestInsertNodeOnEdge: (edgeId: string, clientX: number, clientY: number) => void;
};

type DesignerFlowNode = ReactFlowNode<DesignerNodeRenderData, "designerNode">;
type DesignerFlowEdge = ReactFlowEdge<DesignerEdgeRenderData, "designerEdge">;
const DESIGNER_NODE_TYPES = {
  designerNode: DesignerNodeComponent,
} as const;
const DESIGNER_EDGE_TYPES = {
  designerEdge: DesignerEdgeComponent,
} as const;

type BranchHandle = {
  id: string;
  label: string;
  top: string;
  condition: string;
};

function normalizeEdgeCondition(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function isBranchSourceType(type: NodeType | undefined): boolean {
  return type === "if" || type === "loop" || type === "switchCase" || type === "rowLocate";
}

function resolveConditionColor(condition: string | undefined): { stroke: string; labelClassName: string } {
  const normalized = normalizeEdgeCondition(condition);
  if (normalized === "true") {
    return { stroke: "#16a34a", labelClassName: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  }
  if (normalized === "false") {
    return { stroke: "#e11d48", labelClassName: "border-rose-200 bg-rose-50 text-rose-700" };
  }
  if (normalized === "body") {
    return { stroke: "#d97706", labelClassName: "border-amber-200 bg-amber-50 text-amber-700" };
  }
  if (normalized === "exit") {
    return { stroke: "#0ea5e9", labelClassName: "border-sky-200 bg-sky-50 text-sky-700" };
  }
  if (normalized === "found") {
    return { stroke: "#16a34a", labelClassName: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  }
  if (normalized === "notfound") {
    return { stroke: "#f97316", labelClassName: "border-orange-200 bg-orange-50 text-orange-700" };
  }
  if (normalized) {
    return { stroke: "#7c3aed", labelClassName: "border-violet-200 bg-violet-50 text-violet-700" };
  }
  return { stroke: "#94a3b8", labelClassName: "border-slate-200 bg-white text-slate-600" };
}

function getBranchHandles(nodeType: NodeType, config?: Record<string, unknown>): BranchHandle[] {
  if (nodeType === "if") {
    return [
      { id: "if-true", label: "T", top: "34%", condition: "true" },
      { id: "if-false", label: "F", top: "66%", condition: "false" },
    ];
  }
  if (nodeType === "loop") {
    return [
      { id: "loop-body", label: "Loop", top: "34%", condition: "body" },
      { id: "loop-exit", label: "Exit", top: "66%", condition: "exit" },
    ];
  }
  if (nodeType === "switchCase") {
    const options = normalizeSwitchCaseOptions(config?.cases);
    const total = options.length;
    return options.map((item, index) => {
      const top = `${Math.round(((index + 1) / (total + 1)) * 100)}%`;
      return {
        id: `switch-case-${index}`,
        label: item.length > 8 ? `${item.slice(0, 8)}...` : item,
        top,
        condition: item,
      };
    });
  }
  if (nodeType === "rowLocate") {
    return [
      { id: "row-found", label: "Found", top: "34%", condition: "found" },
      { id: "row-not-found", label: "Missing", top: "66%", condition: "notFound" },
    ];
  }
  return [];
}

function resolveConnectionCondition(
  sourceType: NodeType | undefined,
  sourceConfig: Record<string, unknown> | undefined,
  sourceHandle: string | null | undefined
): string | undefined {
  if (!sourceType) {
    return undefined;
  }
  if (sourceType === "if") {
    if (sourceHandle === "if-true") {
      return "true";
    }
    if (sourceHandle === "if-false") {
      return "false";
    }
    return undefined;
  }
  if (sourceType === "loop") {
    if (sourceHandle === "loop-body") {
      return "body";
    }
    if (sourceHandle === "loop-exit") {
      return "exit";
    }
    return undefined;
  }
  if (sourceType === "switchCase") {
    if (!sourceHandle || !sourceHandle.startsWith("switch-case-")) {
      return undefined;
    }
    const index = Number.parseInt(sourceHandle.replace("switch-case-", ""), 10);
    if (!Number.isFinite(index) || index < 0) {
      return undefined;
    }
    const options = normalizeSwitchCaseOptions(sourceConfig?.cases);
    return options[index] ?? undefined;
  }
  if (sourceType === "rowLocate") {
    if (sourceHandle === "row-found") {
      return "found";
    }
    if (sourceHandle === "row-not-found") {
      return "notFound";
    }
    return undefined;
  }
  return undefined;
}

/** 节点输出变量 Badge 组件 — 点击复制 {{nodeId.key}} 引用 */
function NodeOutputBadges({ nodeId, nodeType }: { nodeId: string; nodeType: string }) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const specs = getNodeOutputSpecs(nodeType);
  if (specs.length === 0) return null;

  function handleCopy(key: string) {
    const ref = buildVariableRef(nodeId, key);
    void navigator.clipboard.writeText(ref).catch(() => {/* ignore */ });
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }

  return (
    <div className="mt-1.5 flex flex-wrap gap-1 nodrag nopan">
      {specs.map(spec => (
        <button
          key={spec.key}
          type="button"
          title={`点击复制引用：{{${nodeId}.${spec.key}}}\n${spec.label}`}
          className="!bg-none text-[9px] font-mono px-1.5 py-0.5 rounded-full border transition-colors focus:outline-none !bg-sky-50 !border-sky-200 !text-sky-700 hover:!bg-sky-100 hover:!border-sky-400"
          onClick={e => { e.stopPropagation(); handleCopy(spec.key); }}
        >
          {copiedKey === spec.key ? "✓ 已复制" : `→ ${spec.key}`}
        </button>
      ))}
    </div>
  );
}

function DesignerNodeComponent(props: NodeProps<DesignerFlowNode>) {
  const { id, data, selected } = props;
  const isEndNode = data.nodeType === "end";
  const isStartNode = data.nodeType === "start";
  const branchHandles = getBranchHandles(data.nodeType, data.config);
  const hasBranchHandles = branchHandles.length > 0;
  const disableQuickAdd = isEndNode || hasBranchHandles;

  const typeClass =
    data.nodeType === "start" || data.nodeType === "end"
      ? "bg-emerald-500 text-white"
      : data.nodeType === "if" || data.nodeType === "loop" || data.nodeType === "switchCase"
        || data.nodeType === "rowLocate"
        ? "bg-amber-500 text-white"
        : "bg-sky-500 text-white";

  return (
    <div
      className={`relative w-[190px] min-h-[92px] rounded-xl bg-white border p-3 shadow-sm transition-all ${selected
        ? "border-indigo-400 ring-2 ring-indigo-300 shadow-md shadow-indigo-200/60"
        : data.hasError
          ? "border-red-300 ring-2 ring-red-200 shadow-md shadow-red-200/50"
          : "border-slate-200 hover:border-slate-300"
        }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-4 !rounded-full !bg-slate-300 !border !border-white"
        style={isStartNode ? { opacity: 0, pointerEvents: "none" } : undefined}
      />
      {hasBranchHandles ? (
        branchHandles.map(handle => (
          <div key={handle.id}>
            <Handle
              type="source"
              id={handle.id}
              position={Position.Right}
              className="!w-3 !h-3 !rounded-full !bg-amber-500 !border !border-white"
              style={isEndNode ? { opacity: 0, pointerEvents: "none" } : { top: handle.top }}
            />
            {!isEndNode ? (
              <span
                className="absolute -right-9 text-[10px] font-semibold text-amber-700 select-none pointer-events-none"
                style={{ top: handle.top, transform: "translateY(-50%)" }}
                title={handle.condition}
              >
                {handle.label}
              </span>
            ) : null}
          </div>
        ))
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          className="!w-3 !h-4 !rounded-full !bg-slate-300 !border !border-white"
          style={isEndNode ? { opacity: 0, pointerEvents: "none" } : undefined}
        />
      )}

      <button
        type="button"
        className={`!bg-none nodrag nopan absolute -right-2 -top-2 w-5 h-5 rounded-full text-[13px] font-bold border shadow-sm flex items-center justify-center transition-colors focus:outline-none ${disableQuickAdd
          ? "!bg-slate-100 !border-slate-200 !text-slate-300 cursor-not-allowed"
          : "!bg-indigo-500 hover:!bg-indigo-600 !border-indigo-500 !text-white"
          }`}
        disabled={disableQuickAdd}
        onClick={event => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          data.onRequestAddFromSource(id, rect.left + 24, rect.top);
        }}
        title={
          isEndNode
            ? "结束节点不支持新增下游节点"
            : hasBranchHandles
              ? "分支节点请从右侧分支端口拖线连接"
              : "从当前节点新增并自动连线"
        }
      >
        +
      </button>

      <button
        type="button"
        className="!bg-none nodrag nopan absolute -top-2 -left-2 w-5 h-5 rounded-full !bg-white border !border-slate-200 !text-slate-400 hover:!border-red-200 hover:!text-red-500 hover:!bg-red-50 text-[10px] font-bold flex items-center justify-center transition-colors shadow-sm focus:outline-none"
        onClick={event => {
          event.stopPropagation();
          data.onRequestRemoveNode(id);
        }}
        title="删除节点"
      >
        ×
      </button>

      <div className="flex flex-col min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-800 truncate leading-tight">
          {data.label || getNodeTypeLabel(data.nodeType)}
        </div>
        {renderNodeConfigSummaryData(data.nodeType, data.config)}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold ${typeClass}`}>
          {data.nodeType}
        </span>
        <span className="text-[10px] text-slate-400 font-mono">{id.slice(0, 8)}</span>
      </div>
      {/* 输出变量得片：点击复制引用表达式 */}
      <NodeOutputBadges nodeId={id} nodeType={data.nodeType} />
    </div>
  );
}

function DesignerEdgeComponent(props: EdgeProps<DesignerFlowEdge>) {
  const { id, selected, data, markerEnd } = props;
  const [edgePath, labelX, labelY] = getBezierPath(props);
  const condition = data?.condition?.trim() || "";
  const conditionColor = resolveConditionColor(condition);
  const strokeColor = selected ? "#6366f1" : conditionColor.stroke;

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth: selected ? 3 : 2
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute flex flex-col items-center gap-1"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all"
          }}
        >
          {condition ? (
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold shadow-sm ${conditionColor.labelClassName}`}
              title={`分支条件: ${condition}`}
            >
              {condition}
            </span>
          ) : null}
          <button
            type="button"
            className="!bg-none nodrag nopan w-6 h-6 rounded-full border !border-indigo-200 !bg-white !text-indigo-600 text-[14px] font-bold shadow-sm hover:!border-indigo-400 hover:!bg-indigo-50 flex items-center justify-center transition-colors focus:outline-none"
            title="在线上插入节点"
            onClick={event => {
              event.stopPropagation();
              if (!data) return;
              const rect = event.currentTarget.getBoundingClientRect();
              data.onRequestInsertNodeOnEdge(id, rect.left, rect.bottom + 8);
            }}
          >
            +
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export function ReactFlowCanvas(props: ReactFlowCanvasProps) {
  const {
    flow,
    selectedNodeId,
    selectedEdgeId,
    errorNodeIds,
    onSelectNode,
    onSelectEdge,
    onAddNode,
    onAddNodeFromSource,
    onInsertNodeOnEdge,
    onRemoveNode,
    onAddEdge,
    onUpdateNodePosition
  } = props;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [instance, setInstance] = useState<ReactFlowInstance<DesignerFlowNode, DesignerFlowEdge> | null>(null);
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null);
  const [viewportDebug, setViewportDebug] = useState<{ x: number; y: number; zoom: number } | null>(null);

  const handleRequestAddFromSource = useCallback(
    (nodeId: string, clientX: number, clientY: number) => {
      setNodeMenu({ type: "source", targetId: nodeId, position: { x: clientX, y: clientY } });
      onSelectNode(nodeId);
      onSelectEdge(null);
    },
    [onSelectEdge, onSelectNode]
  );

  const handleRequestInsertNodeOnEdge = useCallback(
    (edgeId: string, clientX: number, clientY: number) => {
      setNodeMenu({ type: "edge", targetId: edgeId, position: { x: clientX, y: clientY } });
    },
    []
  );

  const baseNodes = useMemo(
    () => flowToReactFlowNodes(flow, selectedNodeId, errorNodeIds),
    [flow, selectedNodeId, errorNodeIds]
  );
  const baseEdges = useMemo(() => flowToReactFlowEdges(flow, selectedEdgeId), [flow, selectedEdgeId]);
  const nodeById = useMemo(
    () =>
      flow.nodes.reduce<Record<string, { type: NodeType; config: Record<string, unknown> }>>((acc, node) => {
        acc[node.id] = { type: node.type, config: node.config };
        return acc;
      }, {}),
    [flow.nodes]
  );

  const nodes = useMemo<DesignerFlowNode[]>(
    () =>
      baseNodes.map(node => ({
        ...node,
        type: "designerNode",
        data: {
          ...node.data,
          onRequestAddFromSource: handleRequestAddFromSource,
          onRequestRemoveNode: onRemoveNode
        }
      })),
    [baseNodes, handleRequestAddFromSource, onRemoveNode]
  );

  const edges = useMemo<DesignerFlowEdge[]>(
    () =>
      baseEdges.map(edge => ({
        ...edge,
        type: "designerEdge",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edge.selected ? "#6366f1" : resolveConditionColor(edge.data?.condition).stroke
        },
        data: {
          ...edge.data,
          onRequestInsertNodeOnEdge: handleRequestInsertNodeOnEdge
        }
      })),
    [baseEdges, handleRequestInsertNodeOnEdge]
  );
  const layoutFingerprint = useMemo(
    () =>
      flow.nodes
        .map((node, index) => {
          const pos = readNodePosition(node, index);
          return `${node.id}:${Math.round(pos.x)}:${Math.round(pos.y)}`;
        })
        .join("|"),
    [flow.nodes]
  );
  const flowBoundsDebug = useMemo(() => {
    if (flow.nodes.length <= 0) {
      return null;
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < flow.nodes.length; index += 1) {
      const node = flow.nodes[index];
      if (!node) {
        continue;
      }
      const position = readNodePosition(node, index);
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      maxX = Math.max(maxX, position.x);
      maxY = Math.max(maxY, position.y);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }
    return {
      minX: Math.round(minX),
      minY: Math.round(minY),
      maxX: Math.round(maxX),
      maxY: Math.round(maxY)
    };
  }, [flow.nodes]);

  const isValidConnection = useCallback(
    (connectionOrEdge: Connection | DesignerFlowEdge) => {
      const connection: Connection = {
        source: connectionOrEdge.source,
        target: connectionOrEdge.target,
        sourceHandle: connectionOrEdge.sourceHandle ?? null,
        targetHandle: connectionOrEdge.targetHandle ?? null,
      };
      if (!connection.source || !connection.target || connection.source === connection.target) {
        return false;
      }
      const source = nodeById[connection.source];
      const target = nodeById[connection.target];
      if (!source || !target) {
        return false;
      }
      if (source.type === "end" || target.type === "start") {
        return false;
      }

      const condition = resolveConnectionCondition(source.type, source.config, connection.sourceHandle);
      const normalizedCondition = normalizeEdgeCondition(condition);
      const isBranchSource = isBranchSourceType(source.type);
      if (isBranchSource && !normalizedCondition) {
        return false;
      }

      const duplicateExact = flow.edges.some(edge => {
        if (edge.source !== connection.source || edge.target !== connection.target) {
          return false;
        }
        return normalizeEdgeCondition(edge.condition) === normalizedCondition;
      });
      if (duplicateExact) {
        return false;
      }

      if (!isBranchSource) {
        const duplicateSameTarget = flow.edges.some(
          edge => edge.source === connection.source && edge.target === connection.target
        );
        return !duplicateSameTarget;
      }

      const duplicateBranch = flow.edges.some(
        edge =>
          edge.source === connection.source &&
          normalizeEdgeCondition(edge.condition) === normalizedCondition
      );
      return !duplicateBranch;
    },
    [flow.edges, nodeById]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<DesignerFlowNode>[]) => {
      for (const change of changes) {
        if (change.type !== "position" || !change.position || change.dragging) {
          continue;
        }
        onUpdateNodePosition(change.id, Math.round(change.position.x), Math.round(change.position.y));
      }
    },
    [onUpdateNodePosition]
  );

  const handleEdgesChange = useCallback(() => {
    // Keep callback wired for controlled mode compatibility with React Flow internals.
  }, []);

  const fitCanvasToNodes = useCallback(
    (nextInstance: ReactFlowInstance<DesignerFlowNode, DesignerFlowEdge>, animated = true) => {
      if (flow.nodes.length <= 0) {
        return;
      }
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < flow.nodes.length; index += 1) {
        const node = flow.nodes[index];
        if (!node) {
          continue;
        }
        const position = readNodePosition(node, index);
        const x = Number.isFinite(position.x) ? position.x : 0;
        const y = Number.isFinite(position.y) ? position.y : 0;
        const width = 190;
        const height = 96;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        void nextInstance.fitView({ padding: 0.16, includeHiddenNodes: true, duration: animated ? 180 : 0 });
        return;
      }
      const padding = 40;
      void nextInstance.fitBounds(
        {
          x: minX - padding,
          y: minY - padding,
          width: Math.max(320, maxX - minX + padding * 2),
          height: Math.max(220, maxY - minY + padding * 2)
        },
        {
          padding: 0.1,
          duration: animated ? 180 : 0
        }
      );
    },
    [flow.nodes]
  );



  const getViewportCenterPosition = useCallback((): NodeCanvasPosition | null => {
    if (!instance || !wrapperRef.current) {
      return null;
    }
    const rect = wrapperRef.current.getBoundingClientRect();
    const viewportCenter = instance.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    });
    return {
      x: Math.max(20, Math.round(viewportCenter.x)),
      y: Math.max(20, Math.round(viewportCenter.y))
    };
  }, [instance]);

  const handleNodeMenuSelect = useCallback((type: NodeType) => {
    if (!nodeMenu) return;

    if (nodeMenu.type === "canvas") {
      onAddNode(type, getViewportCenterPosition() ?? undefined);
    } else if (nodeMenu.type === "source" && nodeMenu.targetId) {
      const sourceNode = flow.nodes.find(node => node.id === nodeMenu.targetId) ?? null;
      const sourcePosition = sourceNode ? readNodePosition(sourceNode) : getViewportCenterPosition();
      const targetPosition = sourcePosition
        ? { x: sourcePosition.x + 240, y: sourcePosition.y }
        : undefined;
      onAddNodeFromSource(nodeMenu.targetId, type, targetPosition);
    } else if (nodeMenu.type === "edge" && nodeMenu.targetId) {
      onInsertNodeOnEdge(nodeMenu.targetId, type);
    }

    setNodeMenu(null);
  }, [flow.nodes, getViewportCenterPosition, nodeMenu, onAddNode, onAddNodeFromSource, onInsertNodeOnEdge]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key.toLowerCase() !== "a") {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      onAddNode("wait", getViewportCenterPosition() ?? undefined);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [getViewportCenterPosition, onAddNode]);

  const handleResetViewport = useCallback(() => {
    if (!instance || flow.nodes.length <= 0) {
      return;
    }
    fitCanvasToNodes(instance, true);
  }, [fitCanvasToNodes, instance, flow.nodes.length]);

  useEffect(() => {
    if (!instance || flow.nodes.length <= 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      fitCanvasToNodes(instance, true);
    }, 16);
    return () => window.clearTimeout(timer);
  }, [fitCanvasToNodes, instance, flow.id, flow.nodes.length, layoutFingerprint]);

  useEffect(() => {
    if (!instance) {
      return;
    }
    const update = () => {
      const viewport = instance.getViewport();
      setViewportDebug({
        x: Math.round(viewport.x),
        y: Math.round(viewport.y),
        zoom: Number(viewport.zoom.toFixed(3))
      });
    };
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [instance, flow.nodes.length, layoutFingerprint]);
  const visibleViewportDebug = instance ? viewportDebug : null;

  return (
    <div ref={wrapperRef} className="flex-1 min-h-[420px] w-full bg-slate-50">
      <ReactFlow<DesignerFlowNode, DesignerFlowEdge>
        fitView
        style={{ width: "100%", height: "100%" }}
        nodes={nodes}
        edges={edges}
        nodeTypes={DESIGNER_NODE_TYPES}
        edgeTypes={DESIGNER_EDGE_TYPES}
        minZoom={0.2}
        maxZoom={2.2}
        proOptions={{ hideAttribution: true }}
        onInit={(nextInstance) => {
          setInstance(nextInstance);
          window.setTimeout(() => {
            fitCanvasToNodes(nextInstance, false);
          }, 0);
          window.setTimeout(() => {
            fitCanvasToNodes(nextInstance, true);
          }, 180);
        }}
        onPaneClick={() => {
          onSelectNode(null);
          onSelectEdge(null);
          setNodeMenu(null);
        }}
        onNodeClick={(_event, node) => {
          onSelectNode(node.id);
          onSelectEdge(null);
        }}
        onEdgeClick={(_event, edge) => {
          onSelectEdge(edge.id);
        }}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        isValidConnection={isValidConnection}
        onConnect={(connection: Connection) => {
          if (!connection.source || !connection.target || connection.source === connection.target) {
            return;
          }
          const source = nodeById[connection.source];
          const condition = resolveConnectionCondition(source?.type, source?.config, connection.sourceHandle);
          onAddEdge(connection.source, connection.target, condition);
        }}
        onNodeDragStop={(_event, node) => {
          onUpdateNodePosition(node.id, Math.round(node.position.x), Math.round(node.position.y));
        }}
        deleteKeyCode={null}
      >
        <Background color="#94a3b8" gap={24} size={1.5} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          style={{ width: 220, height: 150, display: "block" }}
          nodeColor={(node) => {
            const type = (node.data as { nodeType?: string } | undefined)?.nodeType;
            if (type === "start" || type === "end") return "#10b981";
            if (type === "if" || type === "loop" || type === "switchCase" || type === "rowLocate") return "#f59e0b";
            return "#3b82f6";
          }}
          nodeStrokeColor={(node) => {
            const type = (node.data as { nodeType?: string } | undefined)?.nodeType;
            if (type === "start" || type === "end") return "#047857";
            if (type === "if" || type === "loop" || type === "switchCase" || type === "rowLocate") return "#b45309";
            return "#1d4ed8";
          }}
          nodeStrokeWidth={2}
          maskColor="rgba(15, 23, 42, 0.12)"
          className="!z-[20] !bg-white !shadow-xl !border !border-slate-200/70 !rounded-xl !m-4"
        />
        <Controls
          showInteractive={false}
          className="!shadow-lg !rounded-lg overflow-hidden !m-4 !border-slate-200 flex flex-col [&>button]:!bg-white [&>button]:!border-b [&>button:last-child]:!border-b-0 [&>button]:!border-slate-100 hover:[&>button]:!bg-slate-50 [&>button]:!text-slate-600"
        />

        <Panel position="top-left" className="!m-4">
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-slate-200/80 bg-white/95 backdrop-blur shadow-sm px-3 py-1.5 text-[11px] font-bold tracking-wider text-slate-500 uppercase">
              {flow.nodes.length} 节点 <span className="text-slate-300 mx-1">/</span> {flow.edges.length} 连线
            </div>
            <button
              type="button"
              className="!bg-none !bg-white !text-slate-700 rounded-lg border !border-slate-300 px-2.5 py-1.5 text-[11px] font-semibold shadow-sm hover:!bg-slate-100"
              onClick={handleResetViewport}
              title="重置缩放并定位到全部节点"
            >
              重置视图
            </button>
          </div>
          {flowBoundsDebug ? (
            <div className="mt-1 rounded border border-slate-200 bg-white/95 px-2 py-1 text-[10px] font-mono text-slate-500">
              x[{flowBoundsDebug.minX},{flowBoundsDebug.maxX}] y[{flowBoundsDebug.minY},{flowBoundsDebug.maxY}]
            </div>
          ) : null}
          {visibleViewportDebug ? (
            <div className="mt-1 rounded border border-slate-200 bg-white/95 px-2 py-1 text-[10px] font-mono text-slate-500">
              view x={visibleViewportDebug.x} y={visibleViewportDebug.y} z={visibleViewportDebug.zoom}
            </div>
          ) : null}
        </Panel>

        {flow.nodes.length === 0 ? (
          <Panel position="top-left" className="!m-4 !mt-14">
            <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-700 px-3 py-2 text-xs font-medium">
              当前流程没有节点，请先新增或导入流程。
            </div>
          </Panel>
        ) : null}

        <Panel position="top-right" className="!m-4 !w-auto">
          <div className="flex flex-col gap-3 drop-shadow-lg">
            <button
              type="button"
              className="!bg-none !bg-indigo-600 hover:!bg-indigo-700 !text-white px-4 py-2.5 rounded-xl text-[13px] font-bold flex items-center gap-1.5 !border-transparent shadow-xl transition-transform hover:-translate-y-0.5"
              onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect();
                setNodeMenu({ type: "canvas", position: { x: rect.left - 200, y: rect.bottom + 12 } });
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              新建节点
            </button>
          </div>
        </Panel>

        {nodeMenu && (
          <Panel position="top-left" className="!m-0">
            <div style={{ position: "fixed", left: 0, top: 0, width: "100vw", height: "100vh", pointerEvents: "none" }}>
              <div style={{ pointerEvents: "auto", position: "absolute", left: 0, top: 0 }}>
                <AddNodeMenu
                  position={nodeMenu.position}
                  excludeStart={nodeMenu.type !== "canvas"}
                  onSelect={handleNodeMenuSelect}
                  onClose={() => setNodeMenu(null)}
                />
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

function renderNodeConfigSummaryData(nodeType: string, config: Record<string, unknown> | undefined) {
  if (!config) {
    return null;
  }

  let content: React.ReactNode = null;
  switch (nodeType) {
    case "navigate":
      content = config.url ? <span className="text-sky-600 truncate">{String(config.url)}</span> : null;
      break;
    case "click":
    case "hover":
    case "input":
    case "extract":
    case "rowLocate":
    case "assertVisible":
    case "assertText":
    case "waitForVisible":
    case "waitForClickable":
      content = config.selector ? (
        <span className="text-indigo-600 truncate font-mono" title={String(config.selector)}>
          {String(config.selector)}
        </span>
      ) : null;
      break;
    case "wait":
      content = config.ms ? <span className="text-amber-600 truncate">{String(config.ms)} ms</span> : null;
      break;
    case "setVariable":
      content = config.key ? (
        <span className="text-purple-600 truncate">
          {String(config.key)} = {String(config.value ?? "")}
        </span>
      ) : (
        <span className="text-slate-400 italic">未配置变量</span>
      );
      break;
    case "if":
      if (typeof config.operator === "string" && config.operator.trim()) {
        const left = String(config.left ?? "");
        const operator = String(config.operator);
        const right = String(config.right ?? "");
        const summary = right ? `${left} ${operator} ${right}` : `${operator} ${left}`;
        content = <span className="text-amber-600 truncate font-mono">{summary}</span>;
      } else {
        content = config.expression ? <span className="text-amber-600 truncate font-mono">{String(config.expression)}</span> : null;
      }
      break;
    case "switchCase": {
      const options = normalizeSwitchCaseOptions(config.cases);
      content = config.expression ? (
        <span className="text-amber-600 truncate font-mono">
          {String(config.expression)} ({options.length} branches)
        </span>
      ) : (
        <span className="text-amber-600 truncate">{options.length} branches</span>
      );
      break;
    }
    case "loop":
      content =
        typeof config.source === "string" && config.source.trim()
          ? <span className="text-amber-600 truncate font-mono">遍历 {String(config.source)}</span>
          : (config.times ? <span className="text-amber-600 truncate">循环 {String(config.times)} 次</span> : null);
      break;
    case "tableExtract":
      content = config.selector ? (
        <span className="text-indigo-600 truncate font-mono" title={String(config.selector)}>
          表格 {String(config.selector)}
        </span>
      ) : null;
      break;
    case "dbQuery":
      content = config.query ? (
        <span className="text-emerald-600 truncate font-mono flex-1 inline-block" title={String(config.query)}>
          {String(config.query)}
        </span>
      ) : null;
      break;
    case "httpRequest":
    case "webhook":
      content = config.url ? <span className="text-sky-600 truncate">[{String(config.method || "GET")}] {String(config.url)}</span> : null;
      break;
    case "jsonParse":
    case "regexExtract":
      content = config.var ? <span className="text-purple-600 truncate">输出到 {String(config.var)}</span> : null;
      break;
    case "pressKey":
      content = config.key ? <span className="text-sky-600 truncate">按键 {String(config.key)}</span> : null;
      break;
    case "subflow": {
      const katalon =
        config.katalon && typeof config.katalon === "object"
          ? (config.katalon as Record<string, unknown>)
          : null;
      if (katalon) {
        const suitePath =
          (typeof katalon.testSuitePath === "string" && katalon.testSuitePath) ||
          (typeof katalon.testSuiteCollectionPath === "string" && katalon.testSuiteCollectionPath) ||
          "Katalon";
        content = <span className="text-emerald-600 truncate">Katalon: {suitePath}</span>;
      } else {
        content = config.flowId ? <span className="text-indigo-600 truncate">子流程: {String(config.flowId)}</span> : null;
      }
      break;
    }
    default:
      content = null;
      break;
  }

  if (!content) {
    return null;
  }

  return <div className="text-[11px] text-slate-500 mt-1 truncate max-w-[150px] flex items-center">{content}</div>;
}
