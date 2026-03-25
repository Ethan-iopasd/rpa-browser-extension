import type { FlowEdge, FlowModel, FlowNode } from "@rpa/flow-schema/generated/types";

import type { RecorderEvent, RecorderPayload, RecorderPreview } from "../../../shared/types/recorder";
import { deepCloneFlow } from "./flow";
import { normalizeSelectorType, parseSelector, type SelectorType } from "./selector";

const SUPPORTED_ACTIONS = new Set(["navigate", "click", "input", "select"]);
const WAIT_INSERT_THRESHOLD_MS = 1500;

export function parseRecorderPayloadFromText(text: string): {
  payload: RecorderPayload | null;
  error: string | null;
} {
  if (!text.trim()) {
    return { payload: null, error: "录制载荷为空。" };
  }
  try {
    const raw = JSON.parse(text) as unknown;
    const payload = normalizeRecorderPayload(raw);
    if (!payload) {
      return { payload: null, error: "录制载荷结构无效。" };
    }
    return { payload, error: null };
  } catch {
    return { payload: null, error: "JSON 解析失败，请检查格式。" };
  }
}

export function normalizeRecorderPayload(raw: unknown): RecorderPayload | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const data = raw as Partial<RecorderPayload>;
  if (!Array.isArray(data.events)) {
    return null;
  }

  const events = data.events
    .map(normalizeRecorderEvent)
    .filter((event): event is RecorderEvent => event !== null)
    .sort((left, right) => toEpoch(left.timestamp) - toEpoch(right.timestamp));
  if (events.length === 0) {
    return null;
  }

  return {
    source: typeof data.source === "string" ? data.source : "unknown",
    schemaVersion: typeof data.schemaVersion === "string" ? data.schemaVersion : "1.0.0",
    tabId: typeof data.tabId === "number" ? data.tabId : undefined,
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : new Date().toISOString(),
    events
  };
}

function normalizeRecorderEvent(raw: unknown): RecorderEvent | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const event = raw as Partial<RecorderEvent>;
  if (typeof event.timestamp !== "string" || typeof event.action !== "string") {
    return null;
  }
  const action = event.action.toLowerCase();
  if (!SUPPORTED_ACTIONS.has(action)) {
    return null;
  }
  return {
    id: typeof event.id === "string" ? event.id : undefined,
    timestamp: event.timestamp,
    action,
    selector: typeof event.selector === "string" ? event.selector : "unknown",
    value: typeof event.value === "string" ? event.value : undefined,
    text: typeof event.text === "string" ? event.text : undefined,
    inputType: typeof event.inputType === "string" ? event.inputType : undefined,
    page: event.page,
    frame: event.frame,
    selectorCandidates: normalizeSelectorCandidates(event.selectorCandidates, event.selector)
  };
}

function normalizeSelectorCandidates(candidates: unknown, fallbackSelector: unknown): RecorderEvent["selectorCandidates"] {
  const list: Array<{ type: string; value: string; score: number; primary?: boolean }> = [];
  if (Array.isArray(candidates)) {
    for (const item of candidates) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const value = (item as { value?: unknown }).value;
      if (typeof value !== "string" || !value.trim()) {
        continue;
      }
      const type = (item as { type?: unknown }).type;
      const score = (item as { score?: unknown }).score;
      list.push({
        type: typeof type === "string" && type.trim() ? type : "unknown",
        value: value.trim(),
        score: typeof score === "number" && Number.isFinite(score) ? score : 0.5,
        primary: Boolean((item as { primary?: unknown }).primary)
      });
    }
  }
  if (list.length === 0 && typeof fallbackSelector === "string" && fallbackSelector.trim()) {
    list.push({ type: "fallback", value: fallbackSelector.trim(), score: 0.8, primary: true });
  }
  const dedup = new Map<string, { type: string; value: string; score: number; primary?: boolean }>();
  for (const item of list) {
    if (!dedup.has(item.value)) {
      dedup.set(item.value, item);
      continue;
    }
    const existed = dedup.get(item.value);
    if (existed && item.score > existed.score) {
      dedup.set(item.value, item);
    }
  }
  return Array.from(dedup.values())
    .sort((left, right) => {
      if (left.primary && !right.primary) {
        return -1;
      }
      if (!left.primary && right.primary) {
        return 1;
      }
      return right.score - left.score;
    })
    .map((item, index) => ({ ...item, primary: index === 0 }));
}

export function mapRecorderPayloadToFlow(payload: RecorderPayload): {
  flow: FlowModel;
  preview: RecorderPreview;
} {
  const warnings: string[] = [];
  const rawEvents = payload.events.filter(event => SUPPORTED_ACTIONS.has(String(event.action)));
  const events = compactRecorderEvents(rawEvents, warnings);
  if (events.length === 0) {
    warnings.push("未检测到可映射事件。");
  }

  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const startNode = createNode("rec_start", "start", "开始", {});
  nodes.push(startNode);
  nodeIds.add(startNode.id);
  let previousNodeId = startNode.id;
  let lastTime = 0;

  let navigateInserted = false;
  let firstUrl = "";

  const firstKnownUrl = events.find(event => event.page?.url)?.page?.url ?? "";
  if (!events.some(event => event.action === "navigate") && firstKnownUrl) {
    warnings.push("录制结果未包含 navigate，已自动注入首个页面导航节点。");
    const syntheticNavigate: RecorderEvent = {
      timestamp: payload.exportedAt || new Date().toISOString(),
      action: "navigate",
      selector: "window.location",
      page: {
        url: firstKnownUrl,
        title: events[0]?.page?.title
      },
      selectorCandidates: [{ type: "system", value: "window.location", score: 1, primary: true }]
    };
    events.unshift(syntheticNavigate);
  }

  events.forEach((event, index) => {
    const eventTime = toEpoch(event.timestamp);
    if (lastTime > 0 && eventTime > lastTime + WAIT_INSERT_THRESHOLD_MS) {
      const waitMs = Math.min(eventTime - lastTime, 5000);
      const waitNode = createNode(`rec_wait_${index}`, "wait", "等待", { ms: waitMs });
      previousNodeId = attachNode(waitNode, previousNodeId, nodes, edges, nodeIds, edgeIds);
    }
    lastTime = eventTime;

    if (event.action === "navigate") {
      const url = event.page?.url || "";
      if (!url) {
        warnings.push(`第 ${index + 1} 个 navigate 事件缺少 URL。`);
        return;
      }
      if (!navigateInserted) {
        firstUrl = url;
      }
      navigateInserted = true;
      const navigateNode = createNode(`rec_nav_${index}`, "navigate", "打开页面", {
        url,
        title: event.page?.title || "",
        frame: event.frame ?? null
      });
      previousNodeId = attachNode(navigateNode, previousNodeId, nodes, edges, nodeIds, edgeIds);
      return;
    }

    if (event.action === "click") {
      const selectorConfig = mapSelectorConfig(event);
      const clickNode = createNode(`rec_click_${index}`, "click", "点击", {
        selector: selectorConfig.selector,
        selectorType: selectorConfig.selectorType,
        selectorCandidates: selectorConfig.selectorCandidates,
        text: event.text || "",
        frame: event.frame ?? null
      });
      previousNodeId = attachNode(clickNode, previousNodeId, nodes, edges, nodeIds, edgeIds);
      return;
    }

    if (event.action === "input" || event.action === "select") {
      const selectorConfig = mapSelectorConfig(event);
      const inputNode = createNode(`rec_input_${index}`, "input", "输入", {
        selector: selectorConfig.selector,
        selectorType: selectorConfig.selectorType,
        text: event.value || event.text || "",
        inputType: event.inputType || event.action,
        selectorCandidates: selectorConfig.selectorCandidates,
        frame: event.frame ?? null
      });
      previousNodeId = attachNode(inputNode, previousNodeId, nodes, edges, nodeIds, edgeIds);
      return;
    }
  });

  const endNode = createNode("rec_end", "end", "结束", {});
  previousNodeId = attachNode(endNode, previousNodeId, nodes, edges, nodeIds, edgeIds);

  const variables: Record<string, string> = {};
  if (firstUrl) {
    variables.targetUrl = firstUrl;
    const firstNavigate = nodes.find(node => node.type === "navigate");
    if (firstNavigate) {
      firstNavigate.config.url = "{{targetUrl}}";
    }
  }

  const flow: FlowModel = {
    schemaVersion: "1.0.0",
    id: `flow_recorded_${Date.now()}`,
    name: "录制流程",
    variables,
    nodes,
    edges
  };

  return {
    flow,
    preview: {
      eventCount: events.length,
      generatedNodeCount: nodes.length,
      generatedEdgeCount: edges.length,
      conflictResolvedCount: 0,
      warnings
    }
  };
}

function compactRecorderEvents(events: RecorderEvent[], warnings: string[]): RecorderEvent[] {
  if (events.length === 0) {
    return [];
  }
  const compacted: RecorderEvent[] = [];
  const lastInputBySelector = new Map<string, { index: number; ts: number }>();
  let droppedCount = 0;

  for (const event of events) {
    if (event.action !== "input") {
      compacted.push(event);
      continue;
    }
    const selector = (event.selector || "").trim();
    const ts = toEpoch(event.timestamp);
    const latest = lastInputBySelector.get(selector);
    if (latest && ts - latest.ts <= 800) {
      compacted[latest.index] = event;
      lastInputBySelector.set(selector, { index: latest.index, ts });
      droppedCount += 1;
      continue;
    }
    compacted.push(event);
    lastInputBySelector.set(selector, { index: compacted.length - 1, ts });
  }

  if (droppedCount > 0) {
    warnings.push(`已合并 ${droppedCount} 条高频输入事件，减少回放噪声。`);
  }

  return compacted;
}

function createNode(id: string, type: FlowNode["type"], label: string, config: Record<string, unknown>): FlowNode {
  return {
    id,
    type,
    label,
    config
  };
}

function createEdge(id: string, source: string, target: string): FlowEdge {
  return {
    id,
    source,
    target
  };
}

function attachNode(
  nextNode: FlowNode,
  previousNodeId: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
  nodeIds: Set<string>,
  edgeIds: Set<string>
): string {
  const uniqueNodeId = uniqueId(nextNode.id, nodeIds);
  const resolvedNode = { ...nextNode, id: uniqueNodeId };
  nodes.push(resolvedNode);
  nodeIds.add(uniqueNodeId);

  const edgeId = uniqueId(`edge_${edges.length + 1}`, edgeIds);
  const edge = createEdge(edgeId, previousNodeId, uniqueNodeId);
  edges.push(edge);
  edgeIds.add(edgeId);
  return uniqueNodeId;
}

function uniqueId(base: string, used: Set<string>): string {
  const normalized = base.replace(/[^A-Za-z0-9_:-]/g, "_");
  if (!used.has(normalized)) {
    return normalized;
  }
  let index = 2;
  while (used.has(`${normalized}_${index}`)) {
    index += 1;
  }
  return `${normalized}_${index}`;
}

function toEpoch(timestamp: string): number {
  const value = Date.parse(timestamp);
  if (Number.isNaN(value)) {
    return Date.now();
  }
  return value;
}

function mapSelectorConfig(event: RecorderEvent): {
  selector: string;
  selectorType: SelectorType;
  selectorCandidates: Array<{ type: string; value: string; score: number; primary?: boolean }>;
} {
  const fallbackSelector = typeof event.selector === "string" ? event.selector : "";
  const candidates = Array.isArray(event.selectorCandidates) ? event.selectorCandidates : [];
  const primary =
    candidates.find(item => item.primary) ??
    candidates[0] ?? {
      type: "css",
      value: fallbackSelector || "unknown",
      score: 0.5,
      primary: true
    };
  const parsedPrimary = parseSelector(primary.value, normalizeSelectorType(primary.type));
  const selectorCandidates = candidates
    .map((item, index) => {
      const normalizedType = normalizeSelectorType(item.type);
      const parsed = parseSelector(item.value, normalizedType);
      return {
        type: normalizedType,
        value: parsed.encoded || parsed.value || fallbackSelector || "unknown",
        score: typeof item.score === "number" ? item.score : 0.5,
        primary: index === 0 ? true : Boolean(item.primary)
      };
    })
    .filter(item => item.value.trim());
  return {
    selector: parsedPrimary.encoded || parsedPrimary.value || fallbackSelector || "unknown",
    selectorType: parsedPrimary.type,
    selectorCandidates
  };
}

export function applyRecorderImportByStrategy(
  strategy: "replace" | "append" | "preview",
  currentFlow: FlowModel,
  mappedFlow: FlowModel,
  selectedNodeId: string | null
): { flow: FlowModel; conflictResolvedCount: number } {
  if (strategy === "replace" || strategy === "preview") {
    const { flow, resolvedCount } = ensureUniqueFlowIds(mappedFlow, currentFlow, strategy === "preview");
    return { flow, conflictResolvedCount: resolvedCount };
  }
  const merged = appendMappedFlow(currentFlow, mappedFlow, selectedNodeId);
  return merged;
}

function ensureUniqueFlowIds(
  incomingFlow: FlowModel,
  baseFlow: FlowModel,
  keepOriginalWhenNoConflict: boolean
): { flow: FlowModel; resolvedCount: number } {
  const flow = deepCloneFlow(incomingFlow);
  const nodeUsed = new Set(baseFlow.nodes.map(node => node.id));
  const edgeUsed = new Set(baseFlow.edges.map(edge => edge.id));
  const nodeMap = new Map<string, string>();
  let resolvedCount = 0;

  flow.nodes = flow.nodes.map(node => {
    const nextId = uniqueId(node.id, nodeUsed);
    if (nextId !== node.id) {
      resolvedCount += 1;
    } else if (!keepOriginalWhenNoConflict) {
      nodeUsed.add(node.id);
    }
    nodeUsed.add(nextId);
    nodeMap.set(node.id, nextId);
    return { ...node, id: nextId };
  });

  flow.edges = flow.edges.map(edge => {
    const nextId = uniqueId(edge.id, edgeUsed);
    if (nextId !== edge.id) {
      resolvedCount += 1;
    }
    edgeUsed.add(nextId);
    return {
      ...edge,
      id: nextId,
      source: nodeMap.get(edge.source) || edge.source,
      target: nodeMap.get(edge.target) || edge.target
    };
  });

  return { flow, resolvedCount };
}

function appendMappedFlow(
  currentFlow: FlowModel,
  mappedFlow: FlowModel,
  selectedNodeId: string | null
): { flow: FlowModel; conflictResolvedCount: number } {
  const targetFlow = deepCloneFlow(currentFlow);
  const usedNodeIds = new Set(targetFlow.nodes.map(node => node.id));
  const usedEdgeIds = new Set(targetFlow.edges.map(edge => edge.id));
  const importedActions = mappedFlow.nodes.filter(node => node.type !== "start" && node.type !== "end");
  if (importedActions.length === 0) {
    return { flow: targetFlow, conflictResolvedCount: 0 };
  }

  const nodeMap = new Map<string, string>();
  let resolvedCount = 0;
  for (const node of importedActions) {
    const nextId = uniqueId(node.id, usedNodeIds);
    if (nextId !== node.id) {
      resolvedCount += 1;
    }
    usedNodeIds.add(nextId);
    nodeMap.set(node.id, nextId);
    targetFlow.nodes.push({ ...node, id: nextId });
  }

  const internalEdges = mappedFlow.edges.filter(edge => nodeMap.has(edge.source) && nodeMap.has(edge.target));
  for (const edge of internalEdges) {
    const nextEdgeId = uniqueId(edge.id, usedEdgeIds);
    if (nextEdgeId !== edge.id) {
      resolvedCount += 1;
    }
    usedEdgeIds.add(nextEdgeId);
    targetFlow.edges.push({
      ...edge,
      id: nextEdgeId,
      source: nodeMap.get(edge.source) || edge.source,
      target: nodeMap.get(edge.target) || edge.target
    });
  }

  const anchorNode =
    targetFlow.nodes.find(node => node.id === selectedNodeId && node.type !== "end") ||
    [...targetFlow.nodes].reverse().find(node => node.type !== "end") ||
    targetFlow.nodes[0];
  const endNode =
    targetFlow.nodes.find(node => node.type === "end") ||
    (() => {
      const created = createNode(uniqueId("n_end", usedNodeIds), "end", "结束", {});
      targetFlow.nodes.push(created);
      usedNodeIds.add(created.id);
      return created;
    })();

  const firstImported = importedActions[0];
  const lastImported = importedActions[importedActions.length - 1];
  const firstImportedId = firstImported ? nodeMap.get(firstImported.id) : undefined;
  const lastImportedId = lastImported ? nodeMap.get(lastImported.id) : undefined;

  if (anchorNode && firstImportedId) {
    const edgeId = uniqueId(`edge_append_${Date.now()}`, usedEdgeIds);
    usedEdgeIds.add(edgeId);
    targetFlow.edges.push(createEdge(edgeId, anchorNode.id, firstImportedId));
  }
  if (lastImportedId && endNode) {
    const edgeId = uniqueId(`edge_append_end_${Date.now()}`, usedEdgeIds);
    usedEdgeIds.add(edgeId);
    targetFlow.edges.push(createEdge(edgeId, lastImportedId, endNode.id));
  }

  return { flow: targetFlow, conflictResolvedCount: resolvedCount };
}
