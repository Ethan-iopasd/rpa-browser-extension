import type { FlowModel } from "@rpa/flow-schema/generated/types";

import type {
  AlertsResponse,
  RunStatsResponse,
  SchedulePreviewResponse,
  TaskDefinition,
  TaskListResponse,
  TaskTriggerResponse
} from "../../shared/types/task";
import type { RunListResponse } from "./runs";
import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import type { RunOptionsPayload } from "./runs";

export type CreateTaskPayload = {
  name: string;
  type: "manual" | "scheduled" | "batch";
  flow?: FlowModel;
  batchFlows?: FlowModel[];
  schedule?: {
    mode: "manual" | "once" | "interval" | "daily" | "weekly" | "monthly" | "cron";
    runAt?: string;
    intervalSeconds?: number;
    timezone?: string;
    timeOfDay?: string;
    weekdays?: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
    dayOfMonth?: number;
    cronExpr?: string;
  };
  runOptions?: RunOptionsPayload;
  retryPolicy?: {
    maxRetries?: number;
    retryDelayMs?: number;
  };
  tags?: string[];
};

export function createTaskRequest(payload: CreateTaskPayload) {
  return apiPost<CreateTaskPayload, TaskDefinition>("/tasks", payload);
}

export function listTaskRequest(
  query: {
    status?: string;
    type?: string;
    limit?: number;
    offset?: number;
  } = {}
) {
  const params = new URLSearchParams();
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.type) {
    params.set("type", query.type);
  }
  if (typeof query.limit === "number") {
    params.set("limit", String(query.limit));
  }
  if (typeof query.offset === "number") {
    params.set("offset", String(query.offset));
  }
  const suffix = params.toString();
  return apiGet<TaskListResponse>(`/tasks${suffix ? `?${suffix}` : ""}`);
}

export function getTaskRequest(taskId: string) {
  return apiGet<TaskDefinition>(`/tasks/${taskId}`);
}

export function triggerTaskRequest(taskId: string) {
  return apiPost<Record<string, never>, TaskTriggerResponse>(`/tasks/${taskId}/trigger`, {});
}

export function retryLastFailedTaskRequest(taskId: string) {
  return apiPost<Record<string, never>, TaskTriggerResponse>(`/tasks/${taskId}/retry-last-failed`, {});
}

export function pauseTaskRequest(taskId: string) {
  return apiPost<Record<string, never>, TaskDefinition>(`/tasks/${taskId}/pause`, {});
}

export function resumeTaskRequest(taskId: string) {
  return apiPost<Record<string, never>, TaskDefinition>(`/tasks/${taskId}/resume`, {});
}

export function disableTaskRequest(taskId: string) {
  return apiPost<Record<string, never>, TaskDefinition>(`/tasks/${taskId}/disable`, {});
}

export function updateTaskRequest(taskId: string, payload: Partial<CreateTaskPayload>) {
  return apiPatch<Partial<CreateTaskPayload>, TaskDefinition>(`/tasks/${taskId}`, payload);
}

export function deleteTaskRequest(taskId: string) {
  return apiDelete<Record<string, never>>(`/tasks/${taskId}`);
}

export function listTaskRunsRequest(
  taskId: string,
  query: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {}
) {
  const params = new URLSearchParams();
  if (query.status) {
    params.set("status", query.status);
  }
  if (typeof query.limit === "number") {
    params.set("limit", String(query.limit));
  }
  if (typeof query.offset === "number") {
    params.set("offset", String(query.offset));
  }
  const suffix = params.toString();
  return apiGet<RunListResponse>(`/tasks/${taskId}/runs${suffix ? `?${suffix}` : ""}`);
}

export function getRunStatsRequest() {
  return apiGet<RunStatsResponse>("/runs/stats");
}

export function getAlertsRequest() {
  return apiGet<AlertsResponse>("/runs/alerts");
}

export function previewScheduleRequest(payload: {
  schedule: NonNullable<CreateTaskPayload["schedule"]>;
  count?: number;
  fromAt?: string;
}) {
  return apiPost<typeof payload, SchedulePreviewResponse>("/tasks/schedule/preview", payload);
}
