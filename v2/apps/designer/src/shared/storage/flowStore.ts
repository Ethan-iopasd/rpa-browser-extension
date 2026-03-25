import type { FlowModel } from "@rpa/flow-schema/generated/types";

import { sampleFlow } from "../data/sampleFlow";
import type { FlowCatalogItem, FlowStatus, StoredFlowRecord } from "../types/flow";

const FLOW_CATALOG_KEY = "rpa.flow.catalog.v1";
const FLOW_DATA_PREFIX = "rpa.flow.data.";

function nowIso(): string {
  return new Date().toISOString();
}

function flowKey(flowId: string): string {
  return `${FLOW_DATA_PREFIX}${flowId}`;
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isRenderableFlow(flow: unknown): flow is FlowModel {
  if (!flow || typeof flow !== "object") {
    return false;
  }
  const record = flow as Record<string, unknown>;
  if (!Array.isArray(record.nodes) || record.nodes.length === 0) {
    return false;
  }
  const hasNodeId = record.nodes.some(item => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const node = item as Record<string, unknown>;
    return typeof node.id === "string" && node.id.trim().length > 0;
  });
  return hasNodeId;
}

export function listFlows(): FlowCatalogItem[] {
  if (typeof window === "undefined") {
    return [];
  }
  const parsed = safeJsonParse<FlowCatalogItem[]>(window.localStorage.getItem(FLOW_CATALOG_KEY));
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .filter(item => item && typeof item.flowId === "string")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function saveCatalog(items: FlowCatalogItem[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(FLOW_CATALOG_KEY, JSON.stringify(items));
}

function upsertCatalog(flow: FlowModel, status: FlowStatus): void {
  const current = listFlows();
  const updated: FlowCatalogItem = {
    flowId: flow.id,
    name: flow.name || flow.id,
    status,
    updatedAt: nowIso()
  };
  const dedup = current.filter(item => item.flowId !== flow.id);
  dedup.unshift(updated);
  saveCatalog(dedup);
}

export function saveFlow(flow: FlowModel, status: FlowStatus = "draft"): void {
  if (typeof window === "undefined") {
    return;
  }
  const record: StoredFlowRecord = {
    flow,
    status,
    updatedAt: nowIso()
  };
  window.localStorage.setItem(flowKey(flow.id), JSON.stringify(record));
  upsertCatalog(flow, status);
}

export function loadFlow(flowId: string): StoredFlowRecord | null {
  if (typeof window === "undefined") {
    return null;
  }
  const parsed = safeJsonParse<StoredFlowRecord>(window.localStorage.getItem(flowKey(flowId)));
  if (!parsed || !isRenderableFlow(parsed.flow)) {
    return null;
  }
  return parsed;
}

export function deleteFlow(flowId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(flowKey(flowId));
  const nextCatalog = listFlows().filter(item => item.flowId !== flowId);
  saveCatalog(nextCatalog);
}

export function createFlowDraft(): FlowModel {
  const base = Date.now().toString(36);
  const flow = {
    ...sampleFlow,
    id: `flow_${base}`,
    name: `新流程 ${new Date().toLocaleString("zh-CN", { hour12: false })}`
  };
  saveFlow(flow, "draft");
  return flow;
}

export function ensureSeedFlow(): void {
  const flows = listFlows();
  if (flows.length > 0) {
    return;
  }
  saveFlow(sampleFlow, "draft");
}
