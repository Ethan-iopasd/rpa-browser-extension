export type TaskType = "manual" | "scheduled" | "batch";
export type TaskStatus = "active" | "paused" | "disabled";

export type TaskSchedule = {
  mode: "manual" | "once" | "interval" | "daily" | "weekly" | "monthly" | "cron";
  runAt?: string | null;
  intervalSeconds?: number | null;
  timezone?: string | null;
  timeOfDay?: string | null;
  weekdays?: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
  dayOfMonth?: number | null;
  cronExpr?: string | null;
};

export type RetryPolicy = {
  maxRetries: number;
  retryDelayMs: number;
};

export type TaskDefinition = {
  taskId: string;
  name: string;
  type: TaskType;
  status: TaskStatus;
  flow?: Record<string, unknown> | null;
  batchFlows: Array<Record<string, unknown>>;
  schedule: TaskSchedule;
  runOptions?: {
    maxSteps: number;
    defaultTimeoutMs: number;
    defaultMaxRetries: number;
  } | null;
  retryPolicy: RetryPolicy;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  lastRunId?: string | null;
};

export type TaskListResponse = {
  total: number;
  tasks: TaskDefinition[];
};

export type TaskTriggerResponse = {
  taskId: string;
  queuedRuns: number;
  message: string;
};

export type SchedulePreviewResponse = {
  total: number;
  nextRuns: string[];
};

export type RunStatsResponse = {
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  canceledRuns: number;
  avgDurationMs: number;
  p95DurationMs: number;
  failureByCode: Record<string, number>;
  byStatus: Record<string, number>;
};

export type AlertRecord = {
  alertId: string;
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string;
  data: Record<string, unknown>;
};

export type AlertsResponse = {
  total: number;
  alerts: AlertRecord[];
};
