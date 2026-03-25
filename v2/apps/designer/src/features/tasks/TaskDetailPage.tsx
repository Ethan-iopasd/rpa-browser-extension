import { useCallback, useEffect, useState } from "react";

import type { RunRecord } from "../../core/api/runs";
import {
  getTaskRequest,
  listTaskRunsRequest,
  retryLastFailedTaskRequest,
  triggerTaskRequest
} from "../../core/api/tasks";
import type { TaskDefinition } from "../../shared/types/task";

type TaskDetailPageProps = {
  taskId: string;
  onOpenRun: (runId: string) => void;
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function formatTaskStatus(status: string): string {
  if (status === "active") {
    return "启用";
  }
  if (status === "paused") {
    return "暂停";
  }
  if (status === "disabled") {
    return "禁用";
  }
  return status;
}

function formatRunStatus(status: string | null | undefined): string {
  if (!status) {
    return "-";
  }
  if (status === "success") {
    return "成功";
  }
  if (status === "failed") {
    return "失败";
  }
  if (status === "running") {
    return "运行中";
  }
  if (status === "pending") {
    return "排队中";
  }
  if (status === "canceled") {
    return "已取消";
  }
  return status;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatSchedule(task: TaskDefinition): string {
  const schedule = task.schedule;
  if (schedule.mode === "interval") {
    if (schedule.intervalSeconds) {
      return `间隔 ${schedule.intervalSeconds} 秒`;
    }
    return "间隔执行";
  }
  if (schedule.mode === "once") {
    return `一次性（${formatDateTime(schedule.runAt)}）`;
  }
  if (schedule.mode === "daily") {
    return `每天 ${schedule.timeOfDay ?? "--:--"} (${schedule.timezone ?? "UTC"})`;
  }
  if (schedule.mode === "weekly") {
    const weekdays = (schedule.weekdays ?? []).join(", ");
    return `每周 ${weekdays || "-"} ${schedule.timeOfDay ?? "--:--"} (${schedule.timezone ?? "UTC"})`;
  }
  if (schedule.mode === "monthly") {
    return `每月 ${schedule.dayOfMonth ?? "-"} 日 ${schedule.timeOfDay ?? "--:--"} (${schedule.timezone ?? "UTC"})`;
  }
  if (schedule.mode === "cron") {
    return `Cron: ${schedule.cronExpr ?? ""} (${schedule.timezone ?? "UTC"})`;
  }
  return schedule.mode;
}

export function TaskDetailPage(props: TaskDetailPageProps) {
  const { taskId, onOpenRun } = props;
  const [task, setTask] = useState<TaskDefinition | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [panelError, setPanelError] = useState("");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;

  const refresh = useCallback(async () => {
    setLoading(true);
    setPanelError("");
    try {
      const [taskRes, runsRes] = await Promise.all([
        getTaskRequest(taskId),
        listTaskRunsRequest(taskId, { limit: pageSize, offset })
      ]);
      if (!taskRes.ok) {
        setPanelError(`${taskRes.error.code}: ${taskRes.error.message}`);
        return;
      }
      if (!runsRes.ok) {
        setPanelError(`${runsRes.error.code}: ${runsRes.error.message}`);
        return;
      }
      setTask(taskRes.data);
      setRuns(runsRes.data.runs);
      setTotal(runsRes.data.total);
    } finally {
      setLoading(false);
    }
  }, [offset, pageSize, taskId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setPage(1);
  }, [taskId]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  async function trigger() {
    const response = await triggerTaskRequest(taskId);
    if (!response.ok) {
      setPanelError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    await refresh();
  }

  async function retryFailed() {
    const response = await retryLastFailedTaskRequest(taskId);
    if (!response.ok) {
      setPanelError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    await refresh();
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
      <section className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-lg font-semibold text-slate-800">任务详情</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-1.5 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm"
              onClick={() => void refresh()}
              disabled={loading}
            >
              {loading ? "刷新中..." : "刷新"}
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded bg-indigo-500 text-white hover:bg-indigo-600 text-sm"
              onClick={() => void trigger()}
            >
              立即触发
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded bg-amber-500 text-white hover:bg-amber-600 text-sm"
              onClick={() => void retryFailed()}
            >
              失败重跑
            </button>
          </div>
        </div>

        {panelError ? (
          <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2">
            {panelError}
          </div>
        ) : null}

        {task ? (
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm m-0">
            <div>
              <dt className="text-slate-500 text-xs">任务名称</dt>
              <dd className="m-0 font-medium text-slate-800">{task.name}</dd>
            </div>
            <div>
              <dt className="text-slate-500 text-xs">任务 ID</dt>
              <dd className="m-0 font-mono text-slate-700">{task.taskId}</dd>
            </div>
            <div>
              <dt className="text-slate-500 text-xs">类型</dt>
              <dd className="m-0 text-slate-700">{task.type}</dd>
            </div>
            <div>
              <dt className="text-slate-500 text-xs">状态</dt>
              <dd className="m-0 text-slate-700">{formatTaskStatus(task.status)}</dd>
            </div>
            <div>
              <dt className="text-slate-500 text-xs">调度策略</dt>
              <dd className="m-0 text-slate-700">{formatSchedule(task)}</dd>
            </div>
            <div>
              <dt className="text-slate-500 text-xs">下次执行</dt>
              <dd className="m-0 text-slate-700">{formatDateTime(task.nextRunAt)}</dd>
            </div>
          </dl>
        ) : (
          <div className="text-sm text-slate-500">任务不存在或已被删除。</div>
        )}
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between gap-3 text-sm">
          <div className="text-slate-600">
            共 {total} 条，第 {page} / {totalPages} 页
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-slate-600">
              每页
              <select
                className="px-2 py-1 border border-slate-300 rounded"
                value={pageSize}
                onChange={event => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZE_OPTIONS.map(size => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 disabled:opacity-50"
              disabled={page <= 1 || loading}
              onClick={() => setPage(previous => Math.max(1, previous - 1))}
            >
              上一页
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 disabled:opacity-50"
              disabled={page >= totalPages || loading}
              onClick={() => setPage(previous => Math.min(totalPages, previous + 1))}
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <header className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-800">
          运行历史
        </header>
        {runs.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">暂无运行记录。</div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="px-4 py-2">运行 ID</th>
                  <th className="px-4 py-2">状态</th>
                  <th className="px-4 py-2">开始时间</th>
                  <th className="px-4 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map(item => (
                  <tr key={item.runId}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">{item.runId}</td>
                    <td className="px-4 py-2 text-slate-700">{formatRunStatus(item.status)}</td>
                    <td className="px-4 py-2 text-slate-700">{formatDateTime(item.startedAt)}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        className="px-2.5 py-1 rounded border border-indigo-200 text-indigo-600 hover:bg-indigo-50 text-xs"
                        onClick={() => onOpenRun(item.runId)}
                      >
                        查看详情
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
