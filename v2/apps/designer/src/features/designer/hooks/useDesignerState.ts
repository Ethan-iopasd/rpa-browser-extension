import { useEffect, useMemo, useRef, useState } from "react";

import type { FlowEdge, FlowModel, FlowNode, NodeType, RunEvent } from "@rpa/flow-schema/generated/types";

import {
  cancelPickerSessionRequest,
  getPickerSessionRequest,
  pullPickerSessionResultRequest,
  startPickerSessionRequest
} from "../../../core/api/picker";
import { getRunEventsRequest, startRunRequest, validateFlowRequest } from "../../../core/api/runs";
import {
  createTaskRequest,
  disableTaskRequest,
  getAlertsRequest,
  getRunStatsRequest,
  listTaskRequest,
  pauseTaskRequest,
  resumeTaskRequest,
  retryLastFailedTaskRequest,
  triggerTaskRequest
} from "../../../core/api/tasks";
import { sampleFlow } from "../../../shared/data/sampleFlow";
import type { AlertRecord, RunStatsResponse, TaskDefinition } from "../../../shared/types/task";
import type {
  RecorderImportStrategy,
  RecorderPayload,
  RecorderPreview
} from "../../../shared/types/recorder";
import { ensureDesktopNativePickerHostRegistered, isDesktopRuntime } from "../../../shared/desktop/bridge";
import type {
  PickerFrameLocatorSegment,
  PickerFrameSegment,
  PickerResult,
  PickerSelectorCandidate,
  PickerSelectorType
} from "../../../shared/types/picker";
import type {
  DesignerActions,
  DesignerState,
  ElementPickerMode,
  FlowVersionRecord,
  NodePlacement
} from "../types";
import {
  createEdge,
  createNode,
  createVersionRecord,
  deepCloneFlow,
  extractNodeIdsFromErrors,
  extractValidationErrors,
  fallbackNodePosition,
  normalizeSwitchCaseOptions,
  midpointPosition,
  readNodePosition,
  loadVersionsFromStorage,
  parseVariableValue,
  saveVersionsToStorage,
  withNodePosition
} from "../utils/flow";
import {
  applyRecorderImportByStrategy,
  mapRecorderPayloadToFlow,
  normalizeRecorderPayload,
  parseRecorderPayloadFromText
} from "../utils/recorder";

const DEFAULT_RUN_OPTIONS: DesignerState["runOptions"] = {
  maxSteps: 1000,
  defaultTimeoutMs: 5000,
  defaultMaxRetries: 0,
  breakpointNodeIds: [],
  pauseAfterEachNode: false
};
const DEFAULT_BROWSER_MODE = "real";
const DEFAULT_BROWSER_HEADLESS = false;
const DEFAULT_NATIVE_PICKER_TIMEOUT_MS = 180_000;
const NATIVE_PICKER_POLL_MS = 1200;
const NATIVE_PICKER_PENDING_HINT_MS = 12_000;
const TASK_CENTER_DEFAULT_PAGE_SIZE = 20;
const SUPPORTED_PICKER_SELECTOR_TYPES = new Set(["css", "xpath", "text", "role", "playwright"]);
const FRAME_DYNAMIC_ID_PATTERNS = [
  /\d{6,}/,
  /[a-z][-_]?\d{5,}/i,
  /^\d+(\.\d+)?$/,
  /^[a-f0-9]{16,}$/i,
  /(?:^|[-_])iframe[-_]?[a-z0-9_-]*\d+(?:\.\d+)?$/i,
  /^x-[a-z0-9_-]*iframe[a-z0-9_-]*\d+(?:\.\d+)?$/i,
  /^frame[a-z]{1,8}\d+$/i,
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
];

function inferSelectorTypeFromValue(value: string): PickerSelectorType {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("xpath=") || normalized.startsWith("//") || normalized.startsWith(".//")) {
    return "xpath";
  }
  if (normalized.startsWith("text=")) {
    return "text";
  }
  if (normalized.startsWith("role=")) {
    return "role";
  }
  return "css";
}

function normalizePickerSelectorType(
  value: unknown,
  fallback: PickerSelectorType = "css"
): PickerSelectorType {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (SUPPORTED_PICKER_SELECTOR_TYPES.has(normalized)) {
    return normalized as PickerSelectorType;
  }
  if (
    normalized === "id" ||
    normalized === "data-testid" ||
    normalized === "aria-label" ||
    normalized === "name" ||
    normalized === "path"
  ) {
    return "css";
  }
  return fallback;
}

function normalizePickerCandidates(candidates: unknown): PickerSelectorCandidate[] {
  if (!Array.isArray(candidates)) {
    return [];
  }

  const normalized = candidates
    .map(candidate => {
      if (!candidate || typeof candidate !== "object") {
        return null;
      }
      const record = candidate as Record<string, unknown>;
      const rawValue = typeof record.value === "string" ? record.value.trim() : "";
      if (!rawValue) {
        return null;
      }
      const inferredType = inferSelectorTypeFromValue(rawValue);
      const score =
        typeof record.score === "number" && Number.isFinite(record.score)
          ? Math.max(0, Math.min(1, record.score))
          : 0.5;
      return {
        type: normalizePickerSelectorType(record.type, inferredType),
        value: rawValue,
        score,
        primary: Boolean(record.primary)
      };
    })
    .filter((item): item is PickerSelectorCandidate => item !== null);

  if (normalized.length === 0) {
    return [];
  }
  const primaryIndex = normalized.findIndex(item => item.primary === true);
  const effectivePrimaryIndex = primaryIndex >= 0 ? primaryIndex : 0;
  return normalized.map((item, index) => ({
    ...item,
    primary: index === effectivePrimaryIndex
  }));
}

function normalizePickerFramePath(value: unknown): PickerFrameSegment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(item => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const index =
        typeof record.index === "number" && Number.isFinite(record.index) ? Math.floor(record.index) : -1;
      const hint = typeof record.hint === "string" ? record.hint.trim() : "";
      if (!hint && index < 0) {
        return null;
      }
      const normalizeOptional = (candidate: unknown): string | undefined => {
        if (typeof candidate !== "string") {
          return undefined;
        }
        const trimmed = candidate.trim();
        return trimmed || undefined;
      };
      const attrHints: Record<string, string> = {};
      if (record.attrHints && typeof record.attrHints === "object") {
        for (const [rawName, rawValue] of Object.entries(record.attrHints)) {
          const name = String(rawName || "").trim().toLowerCase();
          const value = typeof rawValue === "string" ? rawValue.trim() : "";
          if (!name || !value) {
            continue;
          }
          attrHints[name] = value;
        }
      }
      const tag = normalizeOptional(record.tag);
      const idStable = typeof record.idStable === "boolean" ? record.idStable : undefined;
      return {
        index,
        hint: hint || `frame[${index}]`,
        tag,
        name: normalizeOptional(record.name),
        id: normalizeOptional(record.id),
        idStable,
        src: normalizeOptional(record.src),
        srcHostPath: normalizeOptional(record.srcHostPath),
        srcStableFragment: normalizeOptional(record.srcStableFragment),
        frameBorder: normalizeOptional(record.frameBorder),
        selector: normalizeOptional(record.selector),
        crossOrigin: Boolean(record.crossOrigin),
        ...(Object.keys(attrHints).length > 0 ? { attrHints } : {})
      } as PickerFrameSegment;
    })
    .filter((item): item is PickerFrameSegment => item !== null);
}

function normalizePickerPrimaryCandidate(value: unknown): PickerSelectorCandidate | undefined {
  const [candidate] = normalizePickerCandidates(Array.isArray(value) ? value : [value]);
  return candidate ? { ...candidate } : undefined;
}

function normalizePickerFrameLocatorChain(value: unknown): PickerFrameLocatorSegment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(item => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const depth = typeof record.depth === "number" && Number.isFinite(record.depth) ? Math.floor(record.depth) : -1;
      const index = typeof record.index === "number" && Number.isFinite(record.index) ? Math.floor(record.index) : -1;
      const hint = typeof record.hint === "string" ? record.hint.trim() : "";
      const selectorCandidates = normalizePickerCandidates(record.selectorCandidates);
      const primary = typeof record.primary === "string" ? record.primary.trim() : "";
      if (depth < 0 && index < 0 && !hint && selectorCandidates.length === 0 && !primary) {
        return null;
      }
      return {
        depth: depth >= 0 ? depth : 0,
        hint: hint || `frame#${depth >= 0 ? depth + 1 : 1}`,
        crossOrigin: Boolean(record.crossOrigin),
        index,
        primary: primary || undefined,
        selectorCandidates
      } as PickerFrameLocatorSegment;
    })
    .filter((item): item is PickerFrameLocatorSegment => item !== null);
}

function isLikelyDynamicFrameToken(value: string | undefined): boolean {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return false;
  }
  return FRAME_DYNAMIC_ID_PATTERNS.some(pattern => pattern.test(normalized));
}

function compactFrameSource(source: string | undefined): string {
  const raw = typeof source === "string" ? source.trim() : "";
  if (!raw) {
    return "";
  }
  try {
    const url = new URL(raw, window.location.href);
    const fileName = url.pathname.split("/").filter(Boolean).pop() || url.pathname || "/";
    return `${url.host}${fileName.startsWith("/") ? fileName : `/${fileName}`}`;
  } catch {
    return raw.replace(/^https?:\/\//i, "").slice(0, 60);
  }
}

function buildFramePathStringFromSegments(segments: PickerFrameSegment[]): string {
  if (!Array.isArray(segments) || segments.length === 0) {
    return "top";
  }
  const labels = segments.map((segment, index) => {
    if (segment.crossOrigin) {
      return `cross-origin#${index + 1}`;
    }
    if (segment.name && !isLikelyDynamicFrameToken(segment.name)) {
      return segment.name;
    }
    const idStable =
      typeof segment.idStable === "boolean"
        ? segment.idStable
        : !isLikelyDynamicFrameToken(segment.id);
    if (segment.id && idStable) {
      return `#${segment.id}`;
    }
    if (segment.srcHostPath) {
      return compactFrameSource(segment.srcHostPath);
    }
    if (segment.srcStableFragment) {
      return compactFrameSource(segment.srcStableFragment);
    }
    if (segment.src) {
      return compactFrameSource(segment.src);
    }
    if (segment.frameBorder) {
      return `${segment.tag || "iframe"}[frameborder=${segment.frameBorder}]`;
    }
    if (segment.index >= 0) {
      return `frame[${segment.index}]`;
    }
    if (segment.hint) {
      return segment.hint;
    }
    return `frame#${index + 1}`;
  });
  return ["top", ...labels].join(" > ");
}

function buildPickerSelectorUpdate(payload: unknown): PickerResult | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const selectorCandidates = normalizePickerCandidates(record.selectorCandidates);
  const playwrightCandidates = normalizePickerCandidates(record.playwrightCandidates);
  const effectiveCandidates = selectorCandidates.length > 0 ? selectorCandidates : playwrightCandidates;
  const playwrightPrimary = normalizePickerPrimaryCandidate(record.playwrightPrimary);
  const selectorFromPayload = typeof record.selector === "string" ? record.selector.trim() : "";
  const primaryCandidate =
    playwrightPrimary ??
    effectiveCandidates.find(item => item.primary === true) ??
    effectiveCandidates[0] ??
    null;
  const selectorFromCandidate = typeof primaryCandidate?.value === "string" ? primaryCandidate.value.trim() : "";
  const selector = selectorFromPayload || selectorFromCandidate;
  if (!selector) {
    return null;
  }
  const selectorType = normalizePickerSelectorType(
    record.selectorType,
    inferSelectorTypeFromValue(selector)
  );
  const pageUrl = typeof record.pageUrl === "string" ? record.pageUrl.trim() : "";
  const framePath = normalizePickerFramePath(record.framePath);
  const framePathString = typeof record.framePathString === "string" ? record.framePathString.trim() : "";
  const frameLocatorChain = normalizePickerFrameLocatorChain(record.frameLocatorChain);
  const elementMeta =
    record.elementMeta && typeof record.elementMeta === "object"
      ? ({ ...(record.elementMeta as Record<string, unknown>) } as Record<string, unknown>)
      : undefined;

  return {
    selector,
    selectorType,
    selectorCandidates: effectiveCandidates.map(item => ({ ...item })),
    ...(playwrightPrimary ? { playwrightPrimary: { ...playwrightPrimary } } : {}),
    ...(playwrightCandidates.length > 0 ? { playwrightCandidates: playwrightCandidates.map(item => ({ ...item })) } : {}),
    ...(frameLocatorChain.length > 0
      ? {
          frameLocatorChain: frameLocatorChain.map(item => ({
            ...item,
            selectorCandidates: item.selectorCandidates.map(candidate => ({ ...candidate }))
          }))
        }
      : {}),
    pageUrl: pageUrl || undefined,
    framePath: framePath.length > 0 ? framePath.map(item => ({ ...item })) : undefined,
    framePathString: framePathString || undefined,
    elementMeta
  };
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error.trim();
    }
  }
  return fallback;
}

function _normalizeSelectorLiteralByType(type: PickerSelectorType, selector: string): string {
  const trimmed = selector.trim();
  if (!trimmed) {
    return "";
  }
  if (type === "xpath") {
    return `xpath=${trimmed.replace(/^xpath=/i, "").trim()}`;
  }
  if (type === "text") {
    return `text=${trimmed.replace(/^text=/i, "").trim()}`;
  }
  if (type === "role") {
    return `role=${trimmed.replace(/^role=/i, "").trim()}`;
  }
  if (type === "css" && /^css=/i.test(trimmed)) {
    return trimmed.replace(/^css=/i, "").trim();
  }
  return trimmed;
}

function normalizeSelectorConfig(config: Record<string, unknown>): Record<string, unknown> {
  const rawSelector = typeof config.selector === "string" ? config.selector.trim() : "";
  if (!rawSelector) {
    return config;
  }
  const rawType = normalizePickerSelectorType(config.selectorType, "css");
  const inferredType = inferSelectorTypeFromValue(rawSelector);
  const xpathLiteral =
    /^xpath=/i.test(rawSelector) || rawSelector.startsWith("//") || rawSelector.startsWith(".//") || rawSelector.startsWith("(/");

  let nextType = rawType;
  if (rawType === "xpath" && !xpathLiteral) {
    nextType = inferredType;
  } else if (rawType !== "xpath" && xpathLiteral) {
    nextType = "xpath";
  }
  const normalizedSelector = _normalizeSelectorLiteralByType(nextType, rawSelector);
  if (normalizedSelector === rawSelector && nextType === rawType) {
    return config;
  }
  return {
    ...config,
    selector: normalizedSelector,
    selectorType: nextType
  };
}

function normalizeEdgeCondition(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function isBranchSourceType(type: NodeType): boolean {
  return type === "if" || type === "loop" || type === "switchCase" || type === "rowLocate";
}

function normalizeBranchNodeConfig(nodeType: NodeType, config: Record<string, unknown>): Record<string, unknown> {
  if (nodeType !== "switchCase") {
    return config;
  }
  const options = normalizeSwitchCaseOptions(config.cases);
  return {
    ...config,
    cases: options
  };
}

function pruneSwitchCaseOutgoingEdges(
  edges: FlowEdge[],
  sourceNodeId: string,
  cases: string[]
): FlowEdge[] {
  const allowed = new Set(cases.map(item => item.trim().toLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  return edges.filter(edge => {
    if (edge.source !== sourceNodeId) {
      return true;
    }
    const normalized = normalizeEdgeCondition(edge.condition);
    if (!normalized || !allowed.has(normalized)) {
      return false;
    }
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

type UseDesignerStateOptions = {
  initialFlow?: FlowModel;
  onFlowChange?: (flow: FlowModel) => void;
  enableTaskCenter?: boolean;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureUniqueId(raw: string, fallbackPrefix: string, used: Set<string>): string {
  const base = raw.trim();
  if (base && !used.has(base)) {
    used.add(base);
    return base;
  }
  let index = used.size + 1;
  while (used.has(`${fallbackPrefix}_${index}`)) {
    index += 1;
  }
  const next = `${fallbackPrefix}_${index}`;
  used.add(next);
  return next;
}

function normalizeFlowStructure(flow: FlowModel): FlowModel {
  let changed = false;
  const rawNodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const normalizedNodes: FlowNode[] = [];
  const usedNodeIds = new Set<string>();

  for (const rawNode of rawNodes) {
    if (!rawNode || typeof rawNode !== "object") {
      changed = true;
      continue;
    }
    const node = rawNode as FlowNode;
    const safeType = typeof node.type === "string" && node.type.trim() ? node.type : "wait";
    if (safeType !== node.type) {
      changed = true;
    }
    const nextId = ensureUniqueId(typeof node.id === "string" ? node.id : "", safeType, usedNodeIds);
    if (nextId !== node.id) {
      changed = true;
    }
    const baseConfig = isPlainRecord(node.config) ? node.config : {};
    if (baseConfig !== node.config) {
      changed = true;
    }
    let nextConfig = baseConfig;
    const safePosition = readNodePosition(
      {
        ...node,
        id: nextId,
        type: safeType as NodeType,
        config: baseConfig
      } as FlowNode,
      normalizedNodes.length
    );
    const positionOutOfRange =
      !Number.isFinite(safePosition.x) ||
      !Number.isFinite(safePosition.y) ||
      Math.abs(safePosition.x) > 20_000 ||
      Math.abs(safePosition.y) > 20_000;
    if (positionOutOfRange) {
      nextConfig = withNodePosition(baseConfig, fallbackNodePosition(normalizedNodes.length));
      changed = true;
    }
    const nextLabel = typeof node.label === "string" ? node.label : undefined;
    if (nextLabel !== node.label) {
      changed = true;
    }
    normalizedNodes.push({
      ...node,
      type: safeType as NodeType,
      id: nextId,
      config: nextConfig,
      ...(nextLabel !== undefined ? { label: nextLabel } : {})
    });
  }

  if (normalizedNodes.length === 0) {
    changed = true;
    const startId = ensureUniqueId("n_start", "start", usedNodeIds);
    const endId = ensureUniqueId("n_end", "end", usedNodeIds);
    normalizedNodes.push(
      { id: startId, type: "start", label: "开始", config: {} },
      { id: endId, type: "end", label: "结束", config: {} }
    );
  } else {
    const hasStart = normalizedNodes.some(node => node.type === "start");
    const hasEnd = normalizedNodes.some(node => node.type === "end");
    if (!hasStart) {
      changed = true;
      normalizedNodes.unshift({
        id: ensureUniqueId("n_start", "start", usedNodeIds),
        type: "start",
        label: "开始",
        config: {}
      });
    }
    if (!hasEnd) {
      changed = true;
      normalizedNodes.push({
        id: ensureUniqueId("n_end", "end", usedNodeIds),
        type: "end",
        label: "结束",
        config: {}
      });
    }
  }

  const validNodeIdSet = new Set(normalizedNodes.map(node => node.id));
  const rawEdges = Array.isArray(flow.edges) ? flow.edges : [];
  const normalizedEdges: FlowEdge[] = [];
  const usedEdgeIds = new Set<string>();

  for (const rawEdge of rawEdges) {
    if (!rawEdge || typeof rawEdge !== "object") {
      changed = true;
      continue;
    }
    const edge = rawEdge as FlowEdge;
    const source = typeof edge.source === "string" ? edge.source.trim() : "";
    const target = typeof edge.target === "string" ? edge.target.trim() : "";
    if (!source || !target || source === target) {
      changed = true;
      continue;
    }
    if (!validNodeIdSet.has(source) || !validNodeIdSet.has(target)) {
      changed = true;
      continue;
    }
    const id = ensureUniqueId(typeof edge.id === "string" ? edge.id : "", "edge", usedEdgeIds);
    if (id !== edge.id) {
      changed = true;
    }
    const condition = typeof edge.condition === "string" ? edge.condition.trim() : undefined;
    if (condition !== edge.condition) {
      changed = true;
    }
    normalizedEdges.push({
      ...edge,
      id,
      source,
      target,
      ...(condition ? { condition } : {})
    });
  }

  if (normalizedEdges.length === 0) {
    const startNode = normalizedNodes.find(node => node.type === "start");
    const endNode = normalizedNodes.find(node => node.type === "end");
    if (startNode && endNode && startNode.id !== endNode.id) {
      changed = true;
      normalizedEdges.push({
        id: ensureUniqueId("e_start_end", "edge", usedEdgeIds),
        source: startNode.id,
        target: endNode.id
      });
    }
  }

  if (!changed) {
    return flow;
  }
  return {
    ...flow,
    nodes: normalizedNodes,
    edges: normalizedEdges
  };
}

function ensureBrowserDefaults(flow: FlowModel): FlowModel {
  const normalizedFlow = normalizeFlowStructure(flow);
  const nextVariables = { ...(flow.variables ?? {}) };
  let changed = normalizedFlow !== flow;
  if (
    nextVariables._browserMode !== "real" &&
    nextVariables._browserMode !== "auto" &&
    nextVariables._browserMode !== "simulate"
  ) {
    nextVariables._browserMode = DEFAULT_BROWSER_MODE;
    changed = true;
  }
  if (typeof nextVariables._browserHeadless !== "boolean") {
    nextVariables._browserHeadless = DEFAULT_BROWSER_HEADLESS;
    changed = true;
  }
  const nextNodes = normalizedFlow.nodes.map(node => {
    const normalizedConfig = normalizeSelectorConfig(node.config);
    if (normalizedConfig !== node.config) {
      changed = true;
      return { ...node, config: normalizedConfig };
    }
    return node;
  });
  if (!changed) {
    return normalizedFlow;
  }
  return { ...normalizedFlow, variables: nextVariables, nodes: nextNodes };
}

function resolveOfflineSelfCheckUrl(): string {
  if (typeof window === "undefined") {
    return "http://127.0.0.1:4173/offline/self-check.html";
  }
  return `${window.location.origin}/offline/self-check.html`;
}

function buildOfflineSelfCheckFlow(url: string): FlowModel {
  return {
    schemaVersion: "1.0.0",
    id: `flow_offline_selfcheck_${Date.now()}`,
    name: "Offline Browser Self Check",
    variables: {
      _browserMode: "real",
      _browserHeadless: false,
      selfCheckUrl: url
    },
    nodes: [
      { id: "n_start", type: "start", label: "Start", config: {} },
      {
        id: "n_nav",
        type: "navigate",
        label: "Open local page",
        config: {
          url: "{{selfCheckUrl}}",
          timeoutMs: 15000
        }
      },
      {
        id: "n_wait_ready",
        type: "waitForVisible",
        label: "Wait ready marker",
        config: {
          selector: "#ready",
          timeoutMs: 5000
        }
      },
      {
        id: "n_click_run",
        type: "click",
        label: "Click run button",
        config: {
          selector: "#run-btn",
          timeoutMs: 5000
        }
      },
      {
        id: "n_wait_pass",
        type: "waitForText",
        label: "Wait PASS status",
        config: {
          selector: "#status",
          text: "PASS",
          timeoutMs: 8000
        }
      },
      {
        id: "n_extract",
        type: "extract",
        label: "Extract self check result",
        config: {
          selector: "#result",
          var: "selfCheckResult",
          timeoutMs: 3000
        }
      },
      { id: "n_end", type: "end", label: "End", config: {} }
    ],
    edges: [
      { id: "e1", source: "n_start", target: "n_nav" },
      { id: "e2", source: "n_nav", target: "n_wait_ready" },
      { id: "e3", source: "n_wait_ready", target: "n_click_run" },
      { id: "e4", source: "n_click_run", target: "n_wait_pass" },
      { id: "e5", source: "n_wait_pass", target: "n_extract" },
      { id: "e6", source: "n_extract", target: "n_end" }
    ]
  };
}

export function useDesignerState(options: UseDesignerStateOptions = {}): {
  state: DesignerState;
  actions: DesignerActions;
  selectedNode: FlowNode | null;
  errorNodeIds: string[];
  validationErrors: string[];
} {
  const initialFlow = options.initialFlow;
  const onFlowChange = options.onFlowChange;
  const enableTaskCenter = options.enableTaskCenter;
  const baseFlow = ensureBrowserDefaults(initialFlow ? deepCloneFlow(initialFlow) : deepCloneFlow(sampleFlow));
  const [flow, setFlow] = useState<FlowModel>(() => baseFlow);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [validationState, setValidationState] = useState<DesignerState["validationState"]>(null);
  const [runState, setRunState] = useState<DesignerState["runState"]>(null);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [versions, setVersions] = useState<FlowVersionRecord[]>(() => loadVersionsFromStorage());
  const [runOptions, setRunOptionsState] = useState<DesignerState["runOptions"]>(DEFAULT_RUN_OPTIONS);
  const [recorderPayload, setRecorderPayload] = useState<RecorderPayload | null>(null);
  const [recorderPreview, setRecorderPreview] = useState<RecorderPreview | null>(null);
  const [recorderImportStrategy, setRecorderImportStrategy] =
    useState<RecorderImportStrategy>("preview");
  const [recorderPayloadText, setRecorderPayloadText] = useState("");
  const [mappedRecorderFlow, setMappedRecorderFlow] = useState<FlowModel | null>(null);
  const [isValidating, setValidating] = useState(false);
  const [isRunning, setRunning] = useState(false);
  const [panelMessage, setPanelMessage] = useState("");
  const [panelError, setPanelError] = useState("");
  const [tasks, setTasks] = useState<TaskDefinition[]>([]);
  const [runStats, setRunStats] = useState<RunStatsResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [isTaskLoading, setTaskLoading] = useState(false);
  const [taskTotal, setTaskTotal] = useState(0);
  const [taskPage, setTaskPage] = useState(1);
  const [taskPageSize, setTaskPageSize] = useState(TASK_CENTER_DEFAULT_PAGE_SIZE);
  const [taskName, setTaskName] = useState("当前流程定时任务");
  const [taskIntervalSeconds, setTaskIntervalSeconds] = useState(120);
  const taskOffset = (taskPage - 1) * taskPageSize;
  const taskTotalPages = Math.max(1, Math.ceil(taskTotal / taskPageSize));
  const desktopRuntime = isDesktopRuntime();
  const pickerTargetNodeIdRef = useRef<string | null>(null);
  const nativePickerSessionIdRef = useRef<string | null>(null);
  const nativePickerPollTimerRef = useRef<number | null>(null);
  const nativePickerSessionStartedAtRef = useRef(0);
  const nativePickerPendingHintShownRef = useRef(false);
  const nativePickerDesktopWindowMinimizedRef = useRef(false);
  const flowRef = useRef(flow);

  useEffect(() => {
    flowRef.current = flow;
  }, [flow]);

  useEffect(() => {
    saveVersionsToStorage(versions);
  }, [versions]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const data = event.data as {
        source?: string;
        type?: string;
        payload?: unknown;
        pickerMeta?: unknown;
        targetNodeId?: unknown;
        error?: unknown;
      } | undefined;
      if (!data || data.source !== "rpa-flow-recorder" || typeof data.type !== "string") {
        return;
      }

      if (data.type === "RECORDER_EXPORT_PAYLOAD") {
        const normalized = normalizeRecorderPayload(data.payload);
        if (!normalized) {
          setPanelError("收到录制数据，但结构无效。");
          return;
        }
        loadRecorderPayload(normalized, "已接收扩展推送载荷。");
        return;
      }

      if (data.type === "RECORDER_PICK_RESULT") {
        const payloadNodeId =
          data.payload && typeof data.payload === "object" && typeof (data.payload as Record<string, unknown>).nodeId === "string"
            ? ((data.payload as Record<string, unknown>).nodeId as string).trim()
            : "";
        const envelopeNodeId = typeof data.targetNodeId === "string" ? data.targetNodeId.trim() : "";
        const metaNodeId =
          data.pickerMeta &&
          typeof data.pickerMeta === "object" &&
          typeof (data.pickerMeta as Record<string, unknown>).targetNodeId === "string"
            ? ((data.pickerMeta as Record<string, unknown>).targetNodeId as string).trim()
            : "";
        const candidateNodeIds = [
          pickerTargetNodeIdRef.current || "",
          envelopeNodeId,
          payloadNodeId,
          metaNodeId
        ].filter(item => typeof item === "string" && item.trim());
        const targetNodeId =
          candidateNodeIds.find(candidate => flowRef.current.nodes.some(node => node.id === candidate)) || null;
        console.debug("[rpa-picker] designer received pick result", {
          targetNodeId,
          candidateNodeIds,
          hasPayload: Boolean(data.payload),
          hasPickerMeta: Boolean(data.pickerMeta)
        });
        if (!targetNodeId) {
          setPanelError("未找到待应用节点，请重新发起页面拾取。");
          return;
        }
        const update = buildPickerSelectorUpdate(data.payload);
        if (!update) {
          pickerTargetNodeIdRef.current = null;
          setPanelError("拾取结果无效，请重试。");
          return;
        }
        const pickerMeta =
          data.pickerMeta && typeof data.pickerMeta === "object"
            ? ({ ...(data.pickerMeta as Record<string, unknown>) } as Record<string, unknown>)
            : undefined;
        const metaFramePath = pickerMeta ? normalizePickerFramePath(pickerMeta.framePath) : [];
        const metaFrameLocatorChain = pickerMeta ? normalizePickerFrameLocatorChain(pickerMeta.frameLocatorChain) : [];
        const metaPlaywrightPrimary = pickerMeta ? normalizePickerPrimaryCandidate(pickerMeta.playwrightPrimary) : undefined;
        const metaPlaywrightCandidates = pickerMeta ? normalizePickerCandidates(pickerMeta.playwrightCandidates) : [];
        const metaFramePathString =
          pickerMeta && typeof pickerMeta.framePathString === "string"
            ? pickerMeta.framePathString.trim()
            : "";
        const effectiveFramePath =
          update.framePath && update.framePath.length > 0 ? update.framePath : metaFramePath;
        const effectiveFrameLocatorChain =
          update.frameLocatorChain && update.frameLocatorChain.length > 0
            ? update.frameLocatorChain
            : metaFrameLocatorChain.length > 0
              ? metaFrameLocatorChain.map(item => ({
                  ...item,
                  selectorCandidates: item.selectorCandidates.map(candidate => ({ ...candidate }))
                }))
              : [];
        const effectivePlaywrightPrimary =
          update.playwrightPrimary
            ? { ...update.playwrightPrimary }
            : metaPlaywrightPrimary
              ? { ...metaPlaywrightPrimary }
              : undefined;
        const effectivePlaywrightCandidates =
          update.playwrightCandidates && update.playwrightCandidates.length > 0
            ? update.playwrightCandidates
            : metaPlaywrightCandidates.length > 0
              ? metaPlaywrightCandidates.map(item => ({ ...item }))
              : [];
        const effectiveSelectorCandidates = update.selectorCandidates;
        const rawFramePathString = update.framePathString || metaFramePathString || undefined;
        const effectiveFramePathString =
          effectiveFramePath.length > 0
            ? buildFramePathStringFromSegments(effectiveFramePath)
            : rawFramePathString;

        updateFlow(prev => ({
          ...prev,
          nodes: prev.nodes.map(node =>
            node.id === targetNodeId
              ? {
                  ...node,
                  config: {
                    ...node.config,
                    selector: update.selector,
                    selectorType: update.selectorType,
                    selectorCandidates: effectiveSelectorCandidates,
                    ...(effectivePlaywrightPrimary ? { playwrightPrimary: effectivePlaywrightPrimary } : {}),
                    ...(effectivePlaywrightCandidates.length > 0
                      ? { playwrightCandidates: effectivePlaywrightCandidates }
                      : {}),
                    ...(update.pageUrl ? { pageUrl: update.pageUrl } : {}),
                    ...(effectiveFramePath.length > 0 ? { framePath: effectiveFramePath } : {}),
                    ...(effectiveFrameLocatorChain.length > 0 ? { frameLocatorChain: effectiveFrameLocatorChain } : {}),
                    ...(effectiveFramePathString ? { framePathString: effectiveFramePathString } : {}),
                    ...(update.elementMeta ? { elementMeta: update.elementMeta } : {}),
                    ...(pickerMeta ? { pickerMeta } : {})
                  }
                }
              : node
          )
        }));
        setSelectedNodeId(targetNodeId);
        setSelectedEdgeId(null);
        pickerTargetNodeIdRef.current = null;
        setPanelError("");
        setPanelMessage("页面拾取成功，已更新当前节点选择器。");
        console.debug("[rpa-picker] designer applied picker result", {
          targetNodeId,
          selector: update.selector,
          selectorType: update.selectorType
        });
        return;
      }

      if (data.type === "RECORDER_PICKER_ERROR") {
        console.debug("[rpa-picker] designer received picker error", {
          targetNodeId: pickerTargetNodeIdRef.current,
          error: extractErrorMessage(data.error ?? data.payload, "页面拾取失败。")
        });
        pickerTargetNodeIdRef.current = null;
        setPanelError(extractErrorMessage(data.error ?? data.payload, "页面拾取失败。"));
        return;
      }
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
    };
  }, []);

  useEffect(() => {
    if (enableTaskCenter === false) {
      return;
    }
    void refreshTaskCenter();
  }, [enableTaskCenter, taskOffset, taskPageSize]);

  useEffect(() => {
    if (taskPage > taskTotalPages) {
      setTaskPage(taskTotalPages);
    }
  }, [taskPage, taskTotalPages]);

  useEffect(() => {
    if (!initialFlow) {
      return;
    }
    const normalizedInitialFlow = ensureBrowserDefaults(deepCloneFlow(initialFlow));
    setFlow(normalizedInitialFlow);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setValidationState(null);
    setRunState(null);
    setRunEvents([]);
    setLastRunId(null);
  }, [initialFlow]);

  useEffect(() => {
    if (!onFlowChange) {
      return;
    }
    onFlowChange(flow);
  }, [flow, onFlowChange]);

  useEffect(() => {
    return () => {
      stopNativePickerPolling();
      void cancelActiveNativePickerSession();
    };
  }, []);

  const selectedNode = useMemo(
    () => flow.nodes.find(node => node.id === selectedNodeId) ?? null,
    [flow.nodes, selectedNodeId]
  );
  useEffect(() => {
    if (selectedNodeId && !flow.nodes.some(node => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
    if (selectedEdgeId && !flow.edges.some(edge => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [flow.nodes, flow.edges, selectedNodeId, selectedEdgeId]);
  const validationErrors = useMemo(() => extractValidationErrors(validationState), [validationState]);
  const errorNodeIds = useMemo(() => extractNodeIdsFromErrors(validationErrors), [validationErrors]);

  function updateFlow(updater: (prev: FlowModel) => FlowModel) {
    setFlow(prev => updater(deepCloneFlow(prev)));
  }

  function setFlowName(name: string) {
    updateFlow(prev => ({ ...prev, name }));
  }

  function setFlowId(id: string) {
    updateFlow(prev => ({ ...prev, id }));
  }

  function selectNode(nodeId: string | null) {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setPanelError("");
    setPanelMessage("");
  }

  function selectEdge(edgeId: string | null) {
    setSelectedEdgeId(edgeId);
    if (edgeId) {
      setSelectedNodeId(null);
    }
    setPanelError("");
    setPanelMessage("");
  }

  function addNode(type: NodeType, position?: NodePlacement) {
    const newNode = createNode(type, Date.now());
    const customPosition =
      position && Number.isFinite(position.x) && Number.isFinite(position.y)
        ? { x: Math.max(20, Math.round(position.x)), y: Math.max(20, Math.round(position.y)) }
        : null;
    updateFlow(prev => {
      const selectedNode = prev.nodes.find(node => node.id === selectedNodeId) ?? null;
      const anchorNode =
        (selectedNode && selectedNode.type !== "end" ? selectedNode : null) ??
        [...prev.nodes].reverse().find(node => node.type !== "end") ??
        prev.nodes.find(node => node.type === "start") ??
        null;
      const startNode = prev.nodes.find(node => node.type === "start") ?? null;
      const endNode = prev.nodes.find(node => node.type === "end") ?? null;

      if (customPosition) {
        newNode.config = withNodePosition(newNode.config, customPosition);
      } else if (anchorNode) {
        const basePosition = readNodePosition(anchorNode);
        newNode.config = withNodePosition(newNode.config, {
          x: basePosition.x + 240,
          y: basePosition.y
        });
      }

      const nextNodes = [...prev.nodes, newNode];
      let nextEdges = [...prev.edges];
      const hasEdge = (source: string, target: string) =>
        nextEdges.some(edge => edge.source === source && edge.target === target);
      const appendEdge = (source: string, target: string, condition?: string) => {
        if (!hasEdge(source, target)) {
          nextEdges = [...nextEdges, createEdge(source, target, Date.now() + nextEdges.length, condition)];
        }
      };

      if (newNode.type === "end") {
        if (anchorNode) {
          appendEdge(anchorNode.id, newNode.id);
        } else if (startNode) {
          appendEdge(startNode.id, newNode.id);
        }
        return { ...prev, nodes: nextNodes, edges: nextEdges };
      }

      if (anchorNode) {
        const anchorOutgoing = nextEdges.filter(edge => edge.source === anchorNode.id);
        const preferredOutgoing =
          anchorOutgoing.find(edge => (endNode ? edge.target === endNode.id : false)) ??
          anchorOutgoing[0] ??
          null;
        if (preferredOutgoing) {
          nextEdges = nextEdges.filter(edge => edge.id !== preferredOutgoing.id);
          appendEdge(anchorNode.id, newNode.id);
          appendEdge(newNode.id, preferredOutgoing.target, preferredOutgoing.condition);
        } else {
          appendEdge(anchorNode.id, newNode.id);
          if (endNode) {
            appendEdge(newNode.id, endNode.id);
          }
        }
      } else {
        if (startNode) {
          appendEdge(startNode.id, newNode.id);
        }
        if (endNode) {
          appendEdge(newNode.id, endNode.id);
        }
      }

      return { ...prev, nodes: nextNodes, edges: nextEdges };
    });
    setSelectedNodeId(newNode.id);
    setSelectedEdgeId(null);
    setPanelMessage("已新增节点并接入主链路。");
  }

  function addNodeFromSource(sourceNodeId: string, type: NodeType, position?: NodePlacement) {
    const sourceSnapshot = flow.nodes.find(node => node.id === sourceNodeId) ?? null;
    if (!sourceSnapshot) {
      setPanelError("未找到源节点，无法通过圆点新增。");
      return;
    }
    if (sourceSnapshot.type === "end") {
      setPanelError("结束节点不支持通过圆点新增下游节点。");
      return;
    }
    if (type === "start") {
      setPanelError("圆点新增不支持 start 节点。");
      return;
    }
    const customPosition =
      position && Number.isFinite(position.x) && Number.isFinite(position.y)
        ? { x: Math.max(20, Math.round(position.x)), y: Math.max(20, Math.round(position.y)) }
        : null;

    const newNode = createNode(type, Date.now());
    updateFlow(prev => {
      const sourceNode = prev.nodes.find(node => node.id === sourceNodeId);
      if (!sourceNode) {
        return prev;
      }
      const sourcePosition = readNodePosition(sourceNode);
      const outgoing = prev.edges.filter(edge => edge.source === sourceNodeId);
      const endNode = prev.nodes.find(node => node.type === "end") ?? null;
      let nextEdges = [...prev.edges];
      const hasEdge = (source: string, target: string) =>
        nextEdges.some(edge => edge.source === source && edge.target === target);
      const appendEdge = (source: string, target: string, condition?: string) => {
        if (!hasEdge(source, target)) {
          nextEdges = [...nextEdges, createEdge(source, target, Date.now() + nextEdges.length, condition)];
        }
      };

      if (type === "end") {
        newNode.config = withNodePosition(
          newNode.config,
          customPosition ?? {
            x: sourcePosition.x + 240,
            y: sourcePosition.y
          }
        );
        appendEdge(sourceNodeId, newNode.id);
        return {
          ...prev,
          nodes: [...prev.nodes, newNode],
          edges: nextEdges
        };
      }

      if (outgoing.length === 1) {
        const edge = outgoing[0];
        if (!edge) {
          return prev;
        }
        const targetNode = prev.nodes.find(node => node.id === edge.target);
        if (customPosition) {
          newNode.config = withNodePosition(newNode.config, customPosition);
        } else if (targetNode) {
          const center = midpointPosition(sourcePosition, readNodePosition(targetNode));
          newNode.config = withNodePosition(newNode.config, center);
        } else {
          newNode.config = withNodePosition(newNode.config, {
            x: sourcePosition.x + 240,
            y: sourcePosition.y
          });
        }
        nextEdges = nextEdges.filter(item => item.id !== edge.id);
        appendEdge(sourceNodeId, newNode.id);
        appendEdge(newNode.id, edge.target, edge.condition);
        return {
          ...prev,
          nodes: [...prev.nodes, newNode],
          edges: nextEdges
        };
      }

      newNode.config = withNodePosition(
        newNode.config,
        customPosition ?? {
          x: sourcePosition.x + 240,
          y: sourcePosition.y + Math.max(0, outgoing.length - 1) * 120
        }
      );
      appendEdge(sourceNodeId, newNode.id);
      if (
        outgoing.length === 0 &&
        endNode &&
        sourceNode.id !== endNode.id &&
        endNode.id !== newNode.id
      ) {
        appendEdge(newNode.id, endNode.id);
      }
      return {
        ...prev,
        nodes: [...prev.nodes, newNode],
        edges: nextEdges
      };
    });
    setSelectedNodeId(newNode.id);
    setSelectedEdgeId(null);
    setPanelError("");
    setPanelMessage("已通过节点圆点新增下游节点。");
  }

  function removeNode(nodeId: string) {
    const removedSelectedEdge = flow.edges.find(
      edge => edge.id === selectedEdgeId && (edge.source === nodeId || edge.target === nodeId)
    );
    updateFlow(prev => ({
      ...prev,
      nodes: prev.nodes.filter(node => node.id !== nodeId),
      edges: prev.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId)
    }));
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
    if (removedSelectedEdge) {
      setSelectedEdgeId(null);
    }
    setPanelMessage(`节点 ${nodeId} 已删除。`);
  }

  function updateNode(nodeId: string, patch: Partial<FlowNode>) {
    updateFlow(prev => ({
      ...prev,
      nodes: prev.nodes.map(node => (node.id === nodeId ? { ...node, ...patch } : node))
    }));
  }

  function updateNodeConfig(nodeId: string, key: string, value: unknown) {
    updateFlow(prev => {
      const targetNode = prev.nodes.find(node => node.id === nodeId) ?? null;
      const nextSwitchCaseOptions =
        targetNode?.type === "switchCase" && key === "cases"
          ? normalizeSwitchCaseOptions({
              ...targetNode.config,
              [key]: value
            }.cases)
          : null;
      const nodes = prev.nodes.map(node => {
        if (node.id !== nodeId) {
          return node;
        }
        const nextConfig = normalizeBranchNodeConfig(
          node.type,
          normalizeSelectorConfig({
            ...node.config,
            [key]: value
          })
        );
        return {
          ...node,
          config: nextConfig
        };
      });
      const edges =
        nextSwitchCaseOptions && nextSwitchCaseOptions.length > 0
          ? pruneSwitchCaseOutgoingEdges(prev.edges, nodeId, nextSwitchCaseOptions)
          : prev.edges;
      return {
        ...prev,
        nodes,
        edges
      };
    });
  }

  function replaceNodeConfig(nodeId: string, config: Record<string, unknown>) {
    updateFlow(prev => {
      const targetNode = prev.nodes.find(node => node.id === nodeId) ?? null;
      const nextSwitchCaseOptions =
        targetNode?.type === "switchCase" ? normalizeSwitchCaseOptions(config.cases) : null;
      const nodes = prev.nodes.map(node => {
        if (node.id !== nodeId) {
          return node;
        }
        const nextConfig = normalizeBranchNodeConfig(node.type, normalizeSelectorConfig(config));
        return {
          ...node,
          config: nextConfig
        };
      });
      const edges =
        nextSwitchCaseOptions && nextSwitchCaseOptions.length > 0
          ? pruneSwitchCaseOutgoingEdges(prev.edges, nodeId, nextSwitchCaseOptions)
          : prev.edges;
      return {
        ...prev,
        nodes,
        edges
      };
    });
  }

  function addEdge(source: string, target: string, condition?: string) {
    const sourceNode = flow.nodes.find(node => node.id === source) ?? null;
    const normalizedCondition = normalizeEdgeCondition(condition);
    const isBranchSource = Boolean(sourceNode && isBranchSourceType(sourceNode.type));
    const hasDuplicateExact = flow.edges.some(edge => {
      if (edge.source !== source || edge.target !== target) {
        return false;
      }
      return normalizeEdgeCondition(edge.condition) === normalizedCondition;
    });
    if (hasDuplicateExact) {
      setPanelError("连线已存在，无需重复连接。");
      return;
    }
    if (!isBranchSource && flow.edges.some(edge => edge.source === source && edge.target === target)) {
      setPanelError("连线已存在，无需重复连接。");
      return;
    }
    if (sourceNode && isBranchSourceType(sourceNode.type)) {
      if (!normalizedCondition) {
        setPanelError(`节点 ${sourceNode.id} (${sourceNode.type}) 需要从分支端口连线。`);
        return;
      }
      const duplicateBranch = flow.edges.some(
        edge =>
          edge.source === source &&
          normalizeEdgeCondition(edge.condition) === normalizedCondition
      );
      if (duplicateBranch) {
        setPanelError(`节点 ${sourceNode.id} 的分支 '${normalizedCondition}' 已存在连线。`);
        return;
      }
    }
    const edge = createEdge(source, target, Date.now(), condition);
    updateFlow(prev => ({
      ...prev,
      edges: [...prev.edges, edge]
    }));
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
    setPanelError("");
    setPanelMessage("已新增连线。");
  }

  function updateEdge(edgeId: string, patch: Partial<FlowEdge>) {
    updateFlow(prev => ({
      ...prev,
      edges: prev.edges.map(edge => (edge.id === edgeId ? { ...edge, ...patch } : edge))
    }));
  }

  function removeEdge(edgeId: string) {
    updateFlow(prev => ({
      ...prev,
      edges: prev.edges.filter(edge => edge.id !== edgeId)
    }));
    if (selectedEdgeId === edgeId) {
      setSelectedEdgeId(null);
    }
  }

  function updateNodePosition(nodeId: string, x: number, y: number) {
    updateFlow(prev => ({
      ...prev,
      nodes: prev.nodes.map((node, index) =>
        node.id === nodeId
          ? {
              ...node,
              config: withNodePosition(node.config, { x, y })
            }
          : {
              ...node,
              config: withNodePosition(node.config, readNodePosition(node, index))
            }
      )
    }));
  }

  function insertNodeOnEdge(edgeId: string, type: NodeType) {
    const edge = flow.edges.find(item => item.id === edgeId);
    if (!edge) {
      return;
    }
    const source = flow.nodes.find(node => node.id === edge.source);
    const target = flow.nodes.find(node => node.id === edge.target);
    const newNode = createNode(type, Date.now());
    if (source && target) {
      const sourcePosition = readNodePosition(source);
      const targetPosition = readNodePosition(target);
      const center = midpointPosition(sourcePosition, targetPosition);
      newNode.config = withNodePosition(newNode.config, center);
    }
    updateFlow(prev => {
      const nextEdges = prev.edges.filter(item => item.id !== edgeId);
      const firstEdge = createEdge(edge.source, newNode.id, Date.now());
      const secondEdge = createEdge(newNode.id, edge.target, Date.now() + 1, edge.condition);
      return {
        ...prev,
        nodes: [...prev.nodes, newNode],
        edges: [...nextEdges, firstEdge, secondEdge]
      };
    });
    setSelectedNodeId(newNode.id);
    setSelectedEdgeId(null);
    setPanelMessage("已在连线上插入新节点。");
  }

  function updateVariable(key: string, value: string) {
    if (!key.trim()) {
      return;
    }
    updateFlow(prev => ({
      ...prev,
      variables: {
        ...prev.variables,
        [key.trim()]: parseVariableValue(value)
      }
    }));
  }

  function removeVariable(key: string) {
    updateFlow(prev => {
      const nextVariables = { ...(prev.variables ?? {}) };
      delete nextVariables[key];
      return { ...prev, variables: nextVariables };
    });
  }

  function setRunOptions(patch: Partial<DesignerState["runOptions"]>) {
    setRunOptionsState(prev => {
      const next = { ...prev, ...patch };
      return {
        maxSteps: Number.isFinite(next.maxSteps) && next.maxSteps > 0 ? Math.floor(next.maxSteps) : prev.maxSteps,
        defaultTimeoutMs:
          Number.isFinite(next.defaultTimeoutMs) && next.defaultTimeoutMs > 0
            ? Math.floor(next.defaultTimeoutMs)
            : prev.defaultTimeoutMs,
        defaultMaxRetries:
          Number.isFinite(next.defaultMaxRetries) && next.defaultMaxRetries >= 0
            ? Math.floor(next.defaultMaxRetries)
            : prev.defaultMaxRetries,
        breakpointNodeIds: Array.isArray(next.breakpointNodeIds)
          ? next.breakpointNodeIds.filter(item => typeof item === "string" && item.trim()).map(item => item.trim())
          : prev.breakpointNodeIds,
        pauseAfterEachNode: typeof next.pauseAfterEachNode === "boolean" ? next.pauseAfterEachNode : prev.pauseAfterEachNode
      };
    });
  }

  function setRecorderStrategy(strategy: RecorderImportStrategy) {
    setRecorderImportStrategy(strategy);
  }

  function stopNativePickerPolling() {
    if (nativePickerPollTimerRef.current !== null) {
      window.clearInterval(nativePickerPollTimerRef.current);
      nativePickerPollTimerRef.current = null;
    }
    nativePickerSessionStartedAtRef.current = 0;
    nativePickerPendingHintShownRef.current = false;
  }

  async function minimizeDesktopWindowForPicker() {
    if (!desktopRuntime) {
      return;
    }
    try {
      const webviewWindowApi = await import("@tauri-apps/api/webviewWindow");
      const currentWindow = webviewWindowApi.getCurrentWebviewWindow();
      await currentWindow.minimize();
      nativePickerDesktopWindowMinimizedRef.current = true;
    } catch {
      nativePickerDesktopWindowMinimizedRef.current = false;
    }
  }

  async function restoreDesktopWindowAfterPicker() {
    if (!desktopRuntime) {
      return;
    }
    if (!nativePickerDesktopWindowMinimizedRef.current) {
      return;
    }
    nativePickerDesktopWindowMinimizedRef.current = false;
    try {
      const webviewWindowApi = await import("@tauri-apps/api/webviewWindow");
      const currentWindow = webviewWindowApi.getCurrentWebviewWindow();
      await currentWindow.unminimize();
      await currentWindow.show();
      await currentWindow.setFocus();
    } catch {
      // Best-effort restore.
    }
  }

  function applyNativePickerResult(targetNodeId: string, payload: unknown) {
    void restoreDesktopWindowAfterPicker();
    const update = buildPickerSelectorUpdate(payload);
    if (!update) {
      pickerTargetNodeIdRef.current = null;
      setPanelError("原生拾取返回了无效结果，请重试。");
      return;
    }

    const effectiveFramePath = update.framePath && update.framePath.length > 0 ? update.framePath : [];
    const effectiveFrameLocatorChain = update.frameLocatorChain && update.frameLocatorChain.length > 0
      ? update.frameLocatorChain
      : [];
    const effectivePlaywrightPrimary = update.playwrightPrimary ? { ...update.playwrightPrimary } : undefined;
    const effectivePlaywrightCandidates = update.playwrightCandidates && update.playwrightCandidates.length > 0
      ? update.playwrightCandidates.map(item => ({ ...item }))
      : [];
    const effectiveSelectorCandidates = update.selectorCandidates;
    const effectiveFramePathString =
      effectiveFramePath.length > 0
        ? buildFramePathStringFromSegments(effectiveFramePath)
        : update.framePathString || undefined;

    updateFlow(prev => ({
      ...prev,
      nodes: prev.nodes.map(node =>
        node.id === targetNodeId
          ? {
              ...node,
              config: {
                ...node.config,
                selector: update.selector,
                selectorType: update.selectorType,
                selectorCandidates: effectiveSelectorCandidates,
                ...(effectivePlaywrightPrimary ? { playwrightPrimary: effectivePlaywrightPrimary } : {}),
                ...(effectivePlaywrightCandidates.length > 0
                  ? { playwrightCandidates: effectivePlaywrightCandidates }
                  : {}),
                ...(update.pageUrl ? { pageUrl: update.pageUrl } : {}),
                ...(effectiveFramePath.length > 0 ? { framePath: effectiveFramePath } : {}),
                ...(effectiveFrameLocatorChain.length > 0 ? { frameLocatorChain: effectiveFrameLocatorChain } : {}),
                ...(effectiveFramePathString ? { framePathString: effectiveFramePathString } : {}),
                ...(update.elementMeta ? { elementMeta: update.elementMeta } : {})
              }
            }
          : node
      )
    }));

    setSelectedNodeId(targetNodeId);
    setSelectedEdgeId(null);
    pickerTargetNodeIdRef.current = null;
    setPanelError("");
    setPanelMessage("页面拾取成功，已更新当前节点选择器。");
  }

  async function pollNativePickerSession(sessionId: string, targetNodeId: string) {
    if (!flowRef.current.nodes.some(node => node.id === targetNodeId)) {
      stopNativePickerPolling();
      pickerTargetNodeIdRef.current = null;
      nativePickerSessionIdRef.current = null;
      void restoreDesktopWindowAfterPicker();
      setPanelError("目标节点已不存在，已停止原生拾取。");
      return;
    }

    const result = await getPickerSessionRequest(sessionId);
    if (!result.ok) {
      stopNativePickerPolling();
      nativePickerSessionIdRef.current = null;
      pickerTargetNodeIdRef.current = null;
      void restoreDesktopWindowAfterPicker();
      setPanelError(`查询拾取会话失败：${result.error.code}`);
      return;
    }

    const session = result.data;
    if (session.status === "succeeded") {
      const pullResult = await pullPickerSessionResultRequest(sessionId);
      if (!pullResult.ok) {
        stopNativePickerPolling();
        nativePickerSessionIdRef.current = null;
        pickerTargetNodeIdRef.current = null;
        void restoreDesktopWindowAfterPicker();
        setPanelError(`读取原生拾取结果失败：${pullResult.error.code}`);
        return;
      }
      if (!pullResult.data.found || !pullResult.data.result?.result) {
        return;
      }
      stopNativePickerPolling();
      nativePickerSessionIdRef.current = null;
      applyNativePickerResult(targetNodeId, pullResult.data.result.result);
      return;
    }

    if (session.status === "failed" || session.status === "cancelled" || session.status === "timeout") {
      stopNativePickerPolling();
      nativePickerSessionIdRef.current = null;
      pickerTargetNodeIdRef.current = null;
      void restoreDesktopWindowAfterPicker();
      const reason = session.errorMessage?.trim() || "页面拾取失败。";
      setPanelError(reason);
      return;
    }

    if (
      !nativePickerPendingHintShownRef.current &&
      (session.status === "pending" || session.status === "ready" || session.status === "picking")
    ) {
      const startedAt = nativePickerSessionStartedAtRef.current || Date.now();
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= NATIVE_PICKER_PENDING_HINT_MS) {
        nativePickerPendingHintShownRef.current = true;
        setPanelMessage("原生拾取仍在等待浏览器扩展接入，请确认开发版扩展已加载且浏览器保持开启。");
      }
    }
  }

  function startNativePickerPolling(sessionId: string, targetNodeId: string) {
    stopNativePickerPolling();
    const tick = () => {
      void pollNativePickerSession(sessionId, targetNodeId);
    };
    tick();
    nativePickerPollTimerRef.current = window.setInterval(tick, NATIVE_PICKER_POLL_MS);
  }

  async function cancelActiveNativePickerSession() {
    const sessionId = nativePickerSessionIdRef.current;
    if (!sessionId) {
      return;
    }
    stopNativePickerPolling();
    nativePickerSessionIdRef.current = null;
    try {
      await cancelPickerSessionRequest(sessionId);
    } catch {
      // Best-effort cancellation.
    } finally {
      void restoreDesktopWindowAfterPicker();
    }
  }

  async function startDesktopNativePicker(nodeId: string, url: string) {
    await cancelActiveNativePickerSession();
    pickerTargetNodeIdRef.current = nodeId;

    if (desktopRuntime) {
      const hostStatus = await ensureDesktopNativePickerHostRegistered();
      if (hostStatus && !hostStatus.registered) {
        pickerTargetNodeIdRef.current = null;
        setPanelError(hostStatus.lastError || "原生拾取宿主注册失败，请重启桌面应用后重试。");
        return;
      }
    }

    const result = await startPickerSessionRequest({
      nodeId,
      url: url.trim() || undefined,
      launchMode: "attach_existing",
      timeoutMs: DEFAULT_NATIVE_PICKER_TIMEOUT_MS,
      requestedBy: desktopRuntime ? "desktop_designer" : "designer"
    });
    if (!result.ok) {
      pickerTargetNodeIdRef.current = null;
      const rawMessage = (result.error.message || "").trim();
      const normalizedMessage = rawMessage.toLowerCase();
      const likelyIncompatibleApi =
        (result.error.code === "UNEXPECTED_ERROR" || result.error.code === "HTTP_ERROR") &&
        normalizedMessage.includes("not found");
      if (likelyIncompatibleApi) {
        setPanelError(
          "启动原生拾取失败：当前连接的 API 不支持 picker 接口。请重启桌面服务并确认使用桌面内置 API（127.0.0.1:18080）。"
        );
      } else {
        setPanelError(`启动原生拾取失败：${rawMessage || result.error.code}`);
      }
      return;
    }

    const session = result.data;
    nativePickerSessionIdRef.current = session.sessionId;
    nativePickerSessionStartedAtRef.current = Date.now();
    nativePickerPendingHintShownRef.current = false;
    setPanelError("");
    setPanelMessage("已启动原生拾取，请切换到已打开的浏览器页面点击目标元素（Esc 可取消）。");
    startNativePickerPolling(session.sessionId, nodeId);
    void minimizeDesktopWindowForPicker();
  }

  function showManualExtensionPickerGuide(url: string) {
    const safeUrl = url.trim();
    setPanelError("");
    setPanelMessage(
      safeUrl
        ? `已切换到扩展拾取模式，请按弹窗指引在已登录页面完成拾取并导入结果（目标：${safeUrl}）。`
        : "已切换到扩展拾取模式，请按弹窗指引完成拾取并导入结果。"
    );
  }

  function requestRecorderPayloadFromExtension() {
    if (desktopRuntime) {
      setPanelError("桌面端不支持直接从浏览器扩展拉取，请改用粘贴 JSON 或上传文件。");
      return;
    }
    window.postMessage(
      {
        source: "rpa-flow-designer",
        type: "RECORDER_PULL_LATEST"
      },
      "*"
    );
    setPanelError("");
    setPanelMessage("已向扩展请求最新录制载荷。");
  }

  function startElementPicker(nodeId: string, url: string, mode?: ElementPickerMode) {
    if (!flow.nodes.some(node => node.id === nodeId)) {
      setPanelError("页面拾取失败：目标节点不存在。");
      return;
    }
    if (mode === "extension_manual") {
      showManualExtensionPickerGuide(url);
      return;
    }

    const effectiveMode: ElementPickerMode = mode ?? (desktopRuntime ? "desktop_native" : "extension_bridge");
    if (desktopRuntime || effectiveMode === "desktop_native") {
      void startDesktopNativePicker(nodeId, url);
      return;
    }
    pickerTargetNodeIdRef.current = nodeId;
    window.postMessage(
      {
        source: "rpa-flow-designer",
        type: "RECORDER_PICKER_START",
        payload: {
          nodeId,
          url
        }
      },
      "*"
    );
    setPanelError("");
    setPanelMessage("已打开拾取页面，请在新页面点击目标元素。");
  }

  function loadRecorderPayload(payload: RecorderPayload, successMessage: string) {
    const { flow: mappedFlow, preview } = mapRecorderPayloadToFlow(payload);
    setRecorderPayload(payload);
    setRecorderPayloadText(JSON.stringify(payload, null, 2));
    setMappedRecorderFlow(mappedFlow);
    setRecorderPreview(preview);
    setPanelError("");
    setPanelMessage(successMessage);
  }

  function loadRecorderPayloadFromText() {
    const { payload, error } = parseRecorderPayloadFromText(recorderPayloadText);
    if (!payload) {
      setPanelError(error || "录制载荷无效。");
      return;
    }
    loadRecorderPayload(payload, "录制载荷解析成功。");
  }

  async function loadRecorderPayloadFromFile(file: File) {
    const text = await file.text();
    setRecorderPayloadText(text);
    const { payload, error } = parseRecorderPayloadFromText(text);
    if (!payload) {
      setPanelError(error || "录制载荷无效。");
      return;
    }
    loadRecorderPayload(payload, `已加载录制文件：${file.name}`);
  }

  function applyRecorderImport() {
    if (!mappedRecorderFlow || !recorderPreview) {
      setPanelError("请先解析录制载荷。");
      return;
    }
    const { flow: nextFlow, conflictResolvedCount } = applyRecorderImportByStrategy(
      recorderImportStrategy,
      flow,
      mappedRecorderFlow,
      selectedNodeId
    );

    setRecorderPreview({
      ...recorderPreview,
      conflictResolvedCount
    });

    if (recorderImportStrategy === "preview") {
      setPanelMessage("已生成预览，未修改当前流程。");
      return;
    }

    setFlow(nextFlow);
    setSelectedNodeId(nextFlow.nodes[0]?.id ?? null);
    setSelectedEdgeId(null);
    setValidationState(null);
    setRunState(null);
    setRunEvents([]);
    setLastRunId(null);
    setPanelMessage(
      recorderImportStrategy === "replace"
        ? "已用录制结果替换当前流程。"
        : "已将录制结果追加到当前流程。"
    );
  }

  function clearRecorderImport() {
    setRecorderPayloadText("");
    setRecorderPayload(null);
    setMappedRecorderFlow(null);
    setRecorderPreview(null);
    setPanelMessage("已清空录制导入状态。");
    setPanelError("");
  }

  async function validateFlow() {
    setPanelError("");
    setPanelMessage("");
    setValidating(true);
    const effectiveFlow = ensureBrowserDefaults(flow);
    if (effectiveFlow !== flow) {
      setFlow(effectiveFlow);
    }
    try {
      const result = await validateFlowRequest(effectiveFlow);
      if (!result.ok) {
        setValidationState(result.error);
        setPanelError(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setValidationState(result.data);
      setPanelMessage(result.data.valid ? "流程校验通过。" : "流程校验未通过。");
    } finally {
      setValidating(false);
    }
  }

  async function runFlow(): Promise<string | null> {
    setPanelError("");
    setPanelMessage("");
    setRunning(true);
    setLastRunId(null);
    const effectiveFlow = ensureBrowserDefaults(flow);
    if (effectiveFlow !== flow) {
      setFlow(effectiveFlow);
    }
    try {
      const runResult = await startRunRequest(effectiveFlow, runOptions);
      if (!runResult.ok) {
        setRunState(runResult.error);
        setPanelError(`${runResult.error.code}: ${runResult.error.message}`);
        return null;
      }
      setRunState(runResult.data);
      setLastRunId(runResult.data.runId);
      const eventResult = await getRunEventsRequest(runResult.data.runId);
      if (eventResult.ok) {
        setRunEvents(eventResult.data.events);
        setPanelMessage(`运行完成：${runResult.data.status}`);
      } else {
        setRunEvents(runResult.data.events);
        setPanelError(`事件拉取失败：${eventResult.error.code}`);
      }
      return runResult.data.runId;
    } catch (error) {
      setPanelError(`UNEXPECTED_ERROR: ${extractErrorMessage(error, "运行请求失败。")}`);
      return null;
    } finally {
      setRunning(false);
    }
  }

  async function runOfflineSelfCheck(): Promise<string | null> {
    setPanelError("");
    setPanelMessage("");
    setRunning(true);
    setLastRunId(null);
    const selfCheckFlow = buildOfflineSelfCheckFlow(resolveOfflineSelfCheckUrl());
    const selfCheckOptions = {
      ...runOptions,
      breakpointNodeIds: [],
      pauseAfterEachNode: false,
    };
    try {
      const runResult = await startRunRequest(selfCheckFlow, selfCheckOptions);
      if (!runResult.ok) {
        setRunState(runResult.error);
        setPanelError(`${runResult.error.code}: ${runResult.error.message}`);
        return null;
      }
      setRunState(runResult.data);
      setLastRunId(runResult.data.runId);
      const eventResult = await getRunEventsRequest(runResult.data.runId);
      if (eventResult.ok) {
        setRunEvents(eventResult.data.events);
      } else {
        setRunEvents(runResult.data.events);
      }
      setPanelMessage(`离线自检完成：${runResult.data.status}`);
      return runResult.data.runId;
    } catch (error) {
      setPanelError(`UNEXPECTED_ERROR: ${extractErrorMessage(error, "离线自检请求失败。")}`);
      return null;
    } finally {
      setRunning(false);
    }
  }

  async function refreshTaskCenter() {
    setTaskLoading(true);
    try {
      const [taskRes, statsRes, alertsRes] = await Promise.all([
        listTaskRequest({
          limit: taskPageSize,
          offset: taskOffset
        }),
        getRunStatsRequest(),
        getAlertsRequest()
      ]);
      if (taskRes.ok) {
        setTasks(taskRes.data.tasks);
        setTaskTotal(taskRes.data.total);
      }
      if (statsRes.ok) {
        setRunStats(statsRes.data);
      }
      if (alertsRes.ok) {
        setAlerts(alertsRes.data.alerts);
      }
    } finally {
      setTaskLoading(false);
    }
  }

  function setTaskInterval(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return;
    }
    setTaskIntervalSeconds(Math.floor(seconds));
  }

  function setTaskCenterPage(page: number) {
    if (!Number.isFinite(page)) {
      return;
    }
    setTaskPage(Math.max(1, Math.floor(page)));
  }

  function setTaskCenterPageSize(size: number) {
    if (!Number.isFinite(size) || size <= 0) {
      return;
    }
    setTaskPageSize(Math.floor(size));
    setTaskPage(1);
  }

  async function createCurrentFlowTask() {
    setPanelError("");
    const effectiveFlow = ensureBrowserDefaults(flow);
    if (effectiveFlow !== flow) {
      setFlow(effectiveFlow);
    }
    const response = await createTaskRequest({
      name: taskName.trim() || `${flow.name}-task`,
      type: "scheduled",
      flow: effectiveFlow,
      schedule: {
        mode: "interval",
        intervalSeconds: taskIntervalSeconds
      },
      runOptions,
      retryPolicy: {
        maxRetries: runOptions.defaultMaxRetries,
        retryDelayMs: 1000
      },
      tags: ["designer"]
    });
    if (!response.ok) {
      setPanelError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    setPanelMessage(`任务已创建：${response.data.taskId}`);
    await refreshTaskCenter();
  }

  async function triggerTask(taskId: string) {
    const response = await triggerTaskRequest(taskId);
    if (!response.ok) {
      setPanelError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    setPanelMessage(`任务已入队：${taskId}`);
    await refreshTaskCenter();
  }

  async function pauseTask(taskId: string) {
    const response = await pauseTaskRequest(taskId);
    if (!response.ok) {
      setPanelError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    setPanelMessage(`任务已暂停：${taskId}`);
    await refreshTaskCenter();
  }

  async function resumeTask(taskId: string) {
    const response = await resumeTaskRequest(taskId);
    if (!response.ok) {
      setPanelError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    setPanelMessage(`任务已恢复：${taskId}`);
    await refreshTaskCenter();
  }

  async function disableTask(taskId: string) {
    const response = await disableTaskRequest(taskId);
    if (!response.ok) {
      setPanelError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    setPanelMessage(`任务已禁用：${taskId}`);
    await refreshTaskCenter();
  }

  async function retryLastFailedTask(taskId: string) {
    const response = await retryLastFailedTaskRequest(taskId);
    if (!response.ok) {
      setPanelError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    setPanelMessage(`已发起失败重跑：${taskId}`);
    await refreshTaskCenter();
  }

  function clearPanelMessage() {
    setPanelError("");
    setPanelMessage("");
  }

  function saveVersion(mode: FlowVersionRecord["mode"], label?: string, sourceVersionId?: string) {
    const record = createVersionRecord(flow, mode, label, sourceVersionId);
    setVersions(prev => [record, ...prev].slice(0, 60));
    setPanelMessage(
      mode === "published" ? "已保存发布版本。" : mode === "rollback" ? "已保存回滚快照。" : "已保存草稿。"
    );
  }

  function saveDraft(label?: string) {
    saveVersion("draft", label);
  }

  function publishVersion(label?: string) {
    saveVersion("published", label);
  }

  function rollbackToVersion(versionId: string) {
    const source = versions.find(item => item.id === versionId);
    if (!source) {
      setPanelError("回滚失败：目标版本不存在。");
      return;
    }
    setFlow(deepCloneFlow(source.flow));
    setSelectedNodeId(source.flow.nodes[0]?.id ?? null);
    setSelectedEdgeId(null);
    setValidationState(null);
    setRunState(null);
    setRunEvents([]);
    setLastRunId(null);
    const rollbackRecord = createVersionRecord(source.flow, "rollback", `回滚到 ${source.label}`, source.id);
    setVersions(prev => [rollbackRecord, ...prev].slice(0, 60));
    setPanelMessage("已完成回滚。");
  }

  const state: DesignerState = {
    flow,
    selectedNodeId,
    selectedEdgeId,
    validationState,
    runState,
    runEvents,
    lastRunId,
    versions,
    runOptions,
    recorderPayload,
    recorderPreview,
    recorderImportStrategy,
    recorderPayloadText,
    isValidating,
    isRunning,
    panelMessage,
    panelError,
    tasks,
    runStats,
    alerts,
    isTaskLoading,
    taskTotal,
    taskPage,
    taskPageSize,
    taskName,
    taskIntervalSeconds
  };

  const actions: DesignerActions = {
    setFlowName,
    setFlowId,
    selectNode,
    selectEdge,
    addNode,
    addNodeFromSource,
    insertNodeOnEdge,
    removeNode,
    updateNode,
    updateNodePosition,
    updateNodeConfig,
    replaceNodeConfig,
    addEdge,
    updateEdge,
    removeEdge,
    updateVariable,
    removeVariable,
    setRunOptions,
    setRecorderImportStrategy: setRecorderStrategy,
    setRecorderPayloadText,
    requestRecorderPayloadFromExtension,
    startElementPicker,
    loadRecorderPayloadFromText,
    loadRecorderPayloadFromFile,
    applyRecorderImport,
    clearRecorderImport,
    validateFlow,
    runFlow,
    runOfflineSelfCheck,
    refreshTaskCenter,
    setTaskPage: setTaskCenterPage,
    setTaskPageSize: setTaskCenterPageSize,
    setTaskName,
    setTaskIntervalSeconds: setTaskInterval,
    createCurrentFlowTask,
    triggerTask,
    pauseTask,
    resumeTask,
    disableTask,
    retryLastFailedTask,
    clearPanelMessage,
    saveDraft,
    publishVersion,
    rollbackToVersion
  };

  return {
    state,
    actions,
    selectedNode,
    errorNodeIds,
    validationErrors
  };
}


