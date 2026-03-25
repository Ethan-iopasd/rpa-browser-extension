import { useEffect, useRef, useState } from "react";

import {
  deleteTaskRequest,
  disableTaskRequest,
  listTaskRequest,
  pauseTaskRequest,
  resumeTaskRequest,
  triggerTaskRequest
} from "../../core/api/tasks";
import type { TaskDefinition } from "../../shared/types/task";

type TasksPageProps = {
  onOpenTask: (taskId: string) => void;
  onCreateTask: () => void;
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

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

function formatTaskStatus(value: string): string {
  if (value === "active") {
    return "启用";
  }
  if (value === "paused") {
    return "暂停";
  }
  if (value === "disabled") {
    return "禁用";
  }
  return value;
}

function formatSchedule(schedule: TaskDefinition["schedule"]): string {
  if (schedule.mode === "interval") {
    const seconds = schedule.intervalSeconds ?? 0;
    if (seconds % 60 === 0) {
      return `每 ${Math.max(seconds / 60, 1)} 分钟执行`;
    }
    return `每 ${Math.max(seconds, 1)} 秒执行`;
  }
  if (schedule.mode === "once") {
    return `仅执行一次：${formatDateTime(schedule.runAt)}`;
  }
  if (schedule.mode === "daily") {
    return `每天 ${schedule.timeOfDay ?? "--:--"} (${schedule.timezone ?? "UTC"})`;
  }
  if (schedule.mode === "weekly") {
    const days = (schedule.weekdays ?? []).join(", ");
    return `每周 ${days || "-"} ${schedule.timeOfDay ?? "--:--"} (${schedule.timezone ?? "UTC"})`;
  }
  if (schedule.mode === "monthly") {
    return `每月 ${schedule.dayOfMonth ?? "-"} 日 ${schedule.timeOfDay ?? "--:--"} (${schedule.timezone ?? "UTC"})`;
  }
  if (schedule.mode === "cron") {
    return `Cron: ${schedule.cronExpr ?? ""} (${schedule.timezone ?? "UTC"})`;
  }
  return schedule.mode;
}

export function TasksPage(props: TasksPageProps) {
  const { onOpenTask, onCreateTask } = props;
  const [tasks, setTasks] = useState<TaskDefinition[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [panelError, setPanelError] = useState("");
  // 自定义确认弹窗状态（替代 window.confirm）
  const [confirmState, setConfirmState] = useState<{
    visible: boolean;
    message: string;
    resolve: ((ok: boolean) => void) | null;
  }>({ visible: false, message: "", resolve: null });
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;

  // 自定义 confirm，返回 Promise<boolean>
  function showConfirm(message: string): Promise<boolean> {
    return new Promise(resolve => {
      setConfirmState({ visible: true, message, resolve });
      setTimeout(() => confirmButtonRef.current?.focus(), 50);
    });
  }

  function handleConfirmClose(ok: boolean) {
    setConfirmState(prev => {
      prev.resolve?.(ok);
      return { visible: false, message: "", resolve: null };
    });
  }

  async function refresh() {
    setLoading(true);
    setPanelError("");
    try {
      const response = await listTaskRequest({
        limit: pageSize,
        offset
      });
      if (!response.ok) {
        setPanelError(`${response.error.code}: ${response.error.message}`);
        return;
      }
      setTasks(response.data.tasks);
      setTotal(response.data.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [page, pageSize]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  async function trigger(taskId: string) {
    const response = await triggerTaskRequest(taskId);
    if (!response.ok) {
      setPanelError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    await refresh();
  }

  async function pause(taskId: string) {
    const response = await pauseTaskRequest(taskId);
    if (!response.ok) {
      setPanelError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    await refresh();
  }

  async function resume(taskId: string) {
    const response = await resumeTaskRequest(taskId);
    if (!response.ok) {
      setPanelError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    await refresh();
  }

  async function disable(taskId: string) {
    const response = await disableTaskRequest(taskId);
    if (!response.ok) {
      setPanelError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    await refresh();
  }

  async function remove(taskId: string, taskName: string) {
    const ok = await showConfirm(`确认删除任务「${taskName}」？此操作无法撤销。`);
    if (!ok) return;
    const response = await deleteTaskRequest(taskId);
    if (!response.ok) {
      setPanelError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    await refresh();
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">

      {/* 自定义确认弹窗 */}
      {confirmState.visible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 m-0">删除确认</h3>
                  <p className="mt-1 text-sm text-slate-600 m-0">{confirmState.message}</p>
                </div>
              </div>
            </div>
            <div className="px-5 pb-4 flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded-md border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => handleConfirmClose(false)}
              >
                取消
              </button>
              <button
                ref={confirmButtonRef}
                type="button"
                className="px-3 py-1.5 rounded-md bg-red-600 text-white text-sm hover:bg-red-700"
                onClick={() => handleConfirmClose(true)}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="m-0 text-base font-semibold text-slate-800">任务列表</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-1.5 rounded-md bg-slate-800 text-white text-sm hover:bg-slate-900"
              onClick={onCreateTask}
            >
              新建任务
            </button>
            <button
              type="button"
              className="px-3 py-1.5 border border-slate-300 rounded-md text-sm hover:bg-slate-50"
              onClick={() => void refresh()}
              disabled={loading}
            >
              {loading ? "刷新中..." : "刷新"}
            </button>
          </div>
        </header>

        {panelError ? (
          <div className="px-4 py-3 text-sm text-rose-600 border-b border-rose-100 bg-rose-50">{panelError}</div>
        ) : null}

        {tasks.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">暂无任务。</div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">任务</th>
                  <th className="px-4 py-3 font-semibold">状态</th>
                  <th className="px-4 py-3 font-semibold">调度</th>
                  <th className="px-4 py-3 font-semibold">下次执行</th>
                  <th className="px-4 py-3 font-semibold text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.map(item => (
                  <tr key={item.taskId}>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="text-sky-700 hover:text-sky-900 font-semibold"
                        onClick={() => onOpenTask(item.taskId)}
                      >
                        {item.name}
                      </button>
                      <div className="text-xs text-slate-400 font-mono">{item.taskId}</div>
                    </td>
                    <td className="px-4 py-3">{formatTaskStatus(item.status)}</td>
                    <td className="px-4 py-3 text-xs text-slate-700">{formatSchedule(item.schedule)}</td>
                    <td className="px-4 py-3 text-xs text-slate-700">{formatDateTime(item.nextRunAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          className="px-2 py-1 border border-sky-300 text-sky-700 rounded text-xs hover:bg-sky-50"
                          onClick={() => void trigger(item.taskId)}
                        >
                          触发
                        </button>
                        {item.status === "active" ? (
                          <button
                            type="button"
                            className="px-2 py-1 border border-amber-300 text-amber-700 rounded text-xs hover:bg-amber-50"
                            onClick={() => void pause(item.taskId)}
                          >
                            暂停
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="px-2 py-1 border border-emerald-300 text-emerald-700 rounded text-xs hover:bg-emerald-50"
                            onClick={() => void resume(item.taskId)}
                          >
                            恢复
                          </button>
                        )}
                        <button
                          type="button"
                          className="px-2 py-1 border border-rose-300 text-rose-700 rounded text-xs hover:bg-rose-50"
                          onClick={() => void disable(item.taskId)}
                        >
                          禁用
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 border border-red-400 text-red-700 rounded text-xs hover:bg-red-50 font-semibold"
                          onClick={() => void remove(item.taskId, item.name)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    </div>
  );
}
