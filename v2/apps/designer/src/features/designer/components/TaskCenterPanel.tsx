import type { AlertRecord, RunStatsResponse, TaskDefinition } from "../../../shared/types/task";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

type TaskCenterPanelProps = {
  tasks: TaskDefinition[];
  runStats: RunStatsResponse | null;
  alerts: AlertRecord[];
  isLoading: boolean;
  total: number;
  page: number;
  pageSize: number;
  taskName: string;
  taskIntervalSeconds: number;
  onSetPage: (page: number) => void;
  onSetPageSize: (size: number) => void;
  onSetTaskName: (name: string) => void;
  onSetTaskIntervalSeconds: (seconds: number) => void;
  onCreateTask: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onTriggerTask: (taskId: string) => Promise<void>;
  onPauseTask: (taskId: string) => Promise<void>;
  onResumeTask: (taskId: string) => Promise<void>;
  onDisableTask: (taskId: string) => Promise<void>;
  onRetryLastFailedTask: (taskId: string) => Promise<void>;
};

export function TaskCenterPanel(props: TaskCenterPanelProps) {
  const {
    tasks,
    runStats,
    alerts,
    isLoading,
    total,
    page,
    pageSize,
    taskName,
    taskIntervalSeconds,
    onSetPage,
    onSetPageSize,
    onSetTaskName,
    onSetTaskIntervalSeconds,
    onCreateTask,
    onRefresh,
    onTriggerTask,
    onPauseTask,
    onResumeTask,
    onDisableTask,
    onRetryLastFailedTask
  } = props;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="bg-white/80 backdrop-blur shadow-md shadow-slate-200/50 border border-slate-200 rounded-xl flex flex-col overflow-hidden max-h-[400px]">
      <header className="px-5 py-3 border-b border-slate-100 bg-white flex items-center justify-between sticky top-0 z-10 shrink-0">
        <div>
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 m-0">
            <span className="flex w-5 h-5 bg-sky-100 text-sky-500 rounded items-center justify-center">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </span>
            任务调度中心
          </h2>
          <p className="text-xs text-slate-400 m-0 mt-1">管理定时运行、状态和重试</p>
        </div>
        <button
          type="button"
          className="text-slate-500 hover:text-sky-600 bg-slate-50 hover:bg-sky-50 px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
          onClick={() => void onRefresh()}
          disabled={isLoading}
        >
          {isLoading ? (
            <span className="flex items-center gap-1.5">
              <svg className="animate-spin w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              刷新中...
            </span>
          ) : (
            "刷新状态"
          )}
        </button>
      </header>

      <div className="p-4 flex flex-col lg:flex-row gap-5 overflow-auto bg-slate-50/50">
        <div className="flex flex-col gap-4 w-full lg:w-[320px] shrink-0">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider m-0">新建调度任务</h3>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">任务名称</span>
              <input
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm transition-all focus:bg-white focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 outline-none"
                value={taskName}
                onChange={event => onSetTaskName(event.target.value)}
                placeholder="例如：用户数据同步"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">运行间隔（秒）</span>
              <input
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm transition-all focus:bg-white focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 outline-none"
                type="number"
                min={1}
                value={taskIntervalSeconds}
                onChange={event => onSetTaskIntervalSeconds(Number(event.target.value))}
              />
            </label>
            <button
              type="button"
              className="w-full bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-bold text-sm py-2 rounded-lg shadow mt-1 transition-all"
              onClick={() => void onCreateTask()}
            >
              为当前流程创建任务
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white border border-slate-200 p-3 rounded-xl shadow-sm flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">执行统计</span>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-auto">
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500">总计</span>
                  <span className="text-sm font-bold text-slate-800">{runStats?.totalRuns ?? 0}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500">P95耗时</span>
                  <span className="text-sm font-bold text-slate-800">{runStats?.p95DurationMs ?? 0}毫秒</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-emerald-600 font-medium">成功</span>
                  <span className="text-sm font-bold text-emerald-600">{runStats?.successRuns ?? 0}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-rose-600 font-medium">失败</span>
                  <span className="text-sm font-bold text-rose-600">{runStats?.failedRuns ?? 0}</span>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-3 rounded-xl shadow-sm flex flex-col overflow-hidden">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 shrink-0">系统告警</span>
              <div className="flex flex-col gap-1.5 overflow-y-auto">
                {alerts.length === 0 ? (
                  <span className="text-xs text-slate-400 italic">暂无异常告警</span>
                ) : (
                  alerts.slice(0, 3).map(alert => (
                    <div key={alert.alertId} className="flex gap-1.5 items-start">
                      <span
                        className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
                          alert.level === "error" ? "bg-red-500" : alert.level === "warn" ? "bg-amber-500" : "bg-slate-500"
                        }`}
                      />
                      <span className="text-[10px] font-medium text-slate-600 leading-tight">{alert.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-[500px] border border-slate-200 rounded-xl bg-white overflow-hidden flex flex-col shadow-sm">
          {tasks.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50/50">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-300 mb-3">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-600 m-0">暂无调度任务</p>
              <p className="text-xs text-slate-400 m-0 mt-1">在左侧创建基于当前流程的定时运行任务</p>
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 border-b border-slate-200/80">
                    <th className="font-bold py-2.5 px-4 text-xs uppercase tracking-wider">任务名称</th>
                    <th className="font-bold py-2.5 px-4 text-xs uppercase tracking-wider">状态</th>
                    <th className="font-bold py-2.5 px-4 text-xs uppercase tracking-wider">下次执行</th>
                    <th className="font-bold py-2.5 px-4 text-xs uppercase tracking-wider">最近运行</th>
                    <th className="font-bold py-2.5 px-4 text-xs uppercase tracking-wider text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tasks.map(task => (
                    <tr key={task.taskId} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="py-3 px-4">
                        <div className="flex flex-col">
                          <strong className="text-slate-800">{task.name}</strong>
                          <span className="text-[10px] text-slate-400 font-mono">{task.taskId.substring(0, 8)}...</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold tracking-wide border ${
                            task.status === "active"
                              ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                              : task.status === "paused"
                                ? "bg-amber-50 text-amber-600 border-amber-200"
                                : "bg-slate-100 text-slate-500 border-slate-200"
                          }`}
                        >
                          {formatTaskStatus(task.status)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-xs">{task.nextRunAt ? formatTime(task.nextRunAt) : "-"}</td>
                      <td className="py-3 px-4 text-slate-600 text-xs flex items-center gap-1.5 mt-2">
                        {task.lastRunStatus === "success" && <span className="w-2 h-2 rounded-full bg-emerald-500" title="成功" />}
                        {task.lastRunStatus === "failed" && <span className="w-2 h-2 rounded-full bg-rose-500" title="失败" />}
                        {task.lastRunStatus === "running" && <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" title="运行中" />}
                        {formatRunStatus(task.lastRunStatus)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            className="text-[11px] font-bold text-sky-600 hover:text-white px-2 py-1 rounded border border-sky-200 hover:bg-sky-500 hover:border-sky-500 transition-colors"
                            onClick={() => void onTriggerTask(task.taskId)}
                          >
                            触发
                          </button>
                          {task.status === "active" ? (
                            <button
                              type="button"
                              className="text-[11px] font-bold text-slate-600 hover:text-white px-2 py-1 rounded border border-slate-200 hover:bg-slate-500 hover:border-slate-500 transition-colors"
                              onClick={() => void onPauseTask(task.taskId)}
                            >
                              暂停
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="text-[11px] font-bold text-emerald-600 hover:text-white px-2 py-1 rounded border border-emerald-200 hover:bg-emerald-500 hover:border-emerald-500 transition-colors"
                              onClick={() => void onResumeTask(task.taskId)}
                            >
                              恢复
                            </button>
                          )}
                          <button
                            type="button"
                            className="text-[11px] font-bold text-amber-600 hover:text-white px-2 py-1 rounded border border-amber-200 hover:bg-amber-500 hover:border-amber-500 transition-colors"
                            onClick={() => void onRetryLastFailedTask(task.taskId)}
                          >
                            重跑
                          </button>
                          <button
                            type="button"
                            className="text-[11px] font-bold text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1 rounded transition-colors border border-transparent"
                            onClick={() => void onDisableTask(task.taskId)}
                          >
                            禁用
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
            <div className="text-slate-600">
              共 {total} 条，第 {page} / {totalPages} 页
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-slate-600">
                每页
                <select
                  className="px-2 py-1 border border-slate-300 rounded"
                  value={pageSize}
                  onChange={event => onSetPageSize(Number(event.target.value))}
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
                className="px-2.5 py-1 rounded border border-slate-300 text-slate-700 disabled:opacity-50"
                disabled={page <= 1 || isLoading}
                onClick={() => onSetPage(page - 1)}
              >
                上一页
              </button>
              <button
                type="button"
                className="px-2.5 py-1 rounded border border-slate-300 text-slate-700 disabled:opacity-50"
                disabled={page >= totalPages || isLoading}
                onClick={() => onSetPage(page + 1)}
              >
                下一页
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
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

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

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
