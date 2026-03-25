import type {
  FlowModel,
  RunEvent,
  RunResult,
  ValidateResponse
} from "@rpa/flow-schema/generated/types";

import { apiGet, apiPost } from "./client";
import type { AlertsResponse, RunStatsResponse } from "../../shared/types/task";

export type RunOptionsPayload = {
  maxSteps?: number;
  defaultTimeoutMs?: number;
  defaultMaxRetries?: number;
  breakpointNodeIds?: string[];
  pauseAfterEachNode?: boolean;
};

export type RunRecord = RunResult & {
  taskId?: string;
  triggerType?: string;
  attempt?: number;
  flowSnapshot?: FlowModel;
};

export type RunListResponse = {
  total: number;
  runs: RunRecord[];
};

export type ExportedRunLogs = {
  runId: string;
  format: "jsonl" | "csv";
  fileName: string;
  content: string;
};

export function validateFlowRequest(flow: FlowModel) {
  return apiPost<FlowModel, ValidateResponse>("/flows/validate", flow);
}

export function startRunRequest(
  flow: FlowModel,
  runOptions?: RunOptionsPayload,
  inputVariables?: Record<string, string | number | boolean | null>
) {
  return apiPost<
    {
      flow: FlowModel;
      runOptions?: RunOptionsPayload;
      inputVariables?: Record<string, string | number | boolean | null>;
    },
    RunResult
  >("/runs", {
    flow,
    runOptions,
    inputVariables
  });
}

export function getRunRequest(runId: string) {
  return apiGet<RunRecord>(`/runs/${runId}`);
}

export function listRunsRequest(query: {
  status?: string;
  taskId?: string;
  flowId?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const params = new URLSearchParams();
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.taskId) {
    params.set("taskId", query.taskId);
  }
  if (query.flowId) {
    params.set("flowId", query.flowId);
  }
  if (typeof query.limit === "number") {
    params.set("limit", String(query.limit));
  }
  if (typeof query.offset === "number") {
    params.set("offset", String(query.offset));
  }
  const suffix = params.toString();
  return apiGet<RunListResponse>(`/runs${suffix ? `?${suffix}` : ""}`);
}

export function getRunEventsRequest(
  runId: string,
  query: {
    level?: string;
    nodeId?: string;
    nodeType?: string;
    keyword?: string;
    limit?: number;
    offset?: number;
  } = {}
) {
  const params = new URLSearchParams();
  if (query.level) {
    params.set("level", query.level);
  }
  if (query.nodeId) {
    params.set("nodeId", query.nodeId);
  }
  if (query.nodeType) {
    params.set("nodeType", query.nodeType);
  }
  if (query.keyword) {
    params.set("keyword", query.keyword);
  }
  if (typeof query.limit === "number") {
    params.set("limit", String(query.limit));
  }
  if (typeof query.offset === "number") {
    params.set("offset", String(query.offset));
  }
  const suffix = params.toString();
  return apiGet<{ runId: string; total: number; limit: number; offset: number; events: RunEvent[] }>(
    `/runs/${runId}/events${suffix ? `?${suffix}` : ""}`
  );
}

export function getRunStatsRequest() {
  return apiGet<RunStatsResponse>("/runs/stats");
}

export function getAlertsRequest() {
  return apiGet<AlertsResponse>("/runs/alerts");
}

export function exportRunEventsRequest(
  runId: string,
  format: "jsonl" | "csv",
  query: {
    level?: string;
    nodeId?: string;
    nodeType?: string;
    keyword?: string;
  } = {}
) {
  const params = new URLSearchParams();
  params.set("format", format);
  if (query.level) {
    params.set("level", query.level);
  }
  if (query.nodeId) {
    params.set("nodeId", query.nodeId);
  }
  if (query.nodeType) {
    params.set("nodeType", query.nodeType);
  }
  if (query.keyword) {
    params.set("keyword", query.keyword);
  }
  return apiGet<ExportedRunLogs>(`/runs/${runId}/export?${params.toString()}`);
}
