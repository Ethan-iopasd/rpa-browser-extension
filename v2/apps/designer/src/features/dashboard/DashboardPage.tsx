import { useEffect, useState } from "react";

import { getAlertsRequest, getRunStatsRequest, listRunsRequest } from "../../core/api/runs";
import { listTaskRequest } from "../../core/api/tasks";

type DashboardPageProps = {
  onOpenRun: (runId: string) => void;
  onOpenTask: (taskId: string) => void;
};

export function DashboardPage(props: DashboardPageProps) {
  const { onOpenRun, onOpenTask } = props;
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({
    totalRuns: 0,
    successRuns: 0,
    failedRuns: 0,
    canceledRuns: 0,
    avgDurationMs: 0,
    p95DurationMs: 0
  });
  const [alerts, setAlerts] = useState<Array<{ alertId: string; level: string; message: string }>>([]);
  const [recentRuns, setRecentRuns] = useState<
    Array<{ runId: string; status: string; flowId: string; startedAt: string }>
  >([]);
  const [activeTasks, setActiveTasks] = useState<
    Array<{ taskId: string; name: string; status: string; nextRunAt?: string | null }>
  >([]);

  async function refresh() {
    setLoading(true);
    try {
      const [statsRes, alertsRes, runsRes, tasksRes] = await Promise.all([
        getRunStatsRequest(),
        getAlertsRequest(),
        listRunsRequest({ limit: 8 }),
        listTaskRequest()
      ]);
      if (statsRes.ok) {
        setStats(statsRes.data);
      }
      if (alertsRes.ok) {
        setAlerts(alertsRes.data.alerts);
      }
      if (runsRes.ok) {
        setRecentRuns(runsRes.data.runs.map(item => ({
          runId: item.runId,
          status: item.status,
          flowId: item.flowId,
          startedAt: item.startedAt
        })));
      }
      if (tasksRes.ok) {
        setActiveTasks(
          tasksRes.data.tasks
            .filter(item => item.status === "active")
            .slice(0, 8)
            .map(item => ({
              taskId: item.taskId,
              name: item.name,
              status: item.status,
              nextRunAt: item.nextRunAt
            }))
        );
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 lg:grid-rows-[auto_1fr] gap-6">
      {/* 核心指标概览 */}
      <section className="col-span-1 lg:col-span-2 bg-white/60 backdrop-blur border border-white/50 shadow-sm rounded-2xl p-6 ring-1 ring-slate-900/5">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-lg font-bold text-slate-800 m-0">运行概览</h3>
            <p className="text-sm text-slate-500 m-0 mt-1">系统整体执行质量与调度消耗</p>
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 font-medium transition-colors disabled:opacity-50"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? (
              <svg className="animate-spin h-4 w-4 text-slate-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : "↻ "}
            {loading ? "更新中..." : "刷新看板"}
          </button>
        </header>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-50 border border-slate-100/50 rounded-2xl p-5 flex flex-col gap-1 transition-transform hover:scale-[1.02]">
            <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">总运行记录</span>
            <strong className="text-3xl font-black text-slate-800 font-mono tracking-tight">{stats.totalRuns}</strong>
          </div>
          <div className="bg-green-50/50 border border-green-100 rounded-2xl p-5 flex flex-col gap-1 transition-transform hover:scale-[1.02]">
            <span className="text-green-600/80 text-xs font-semibold uppercase tracking-wider">成功完成</span>
            <strong className="text-3xl font-black text-green-700 font-mono tracking-tight">{stats.successRuns}</strong>
          </div>
          <div className="bg-red-50/50 border border-red-100 rounded-2xl p-5 flex flex-col gap-1 transition-transform hover:scale-[1.02]">
            <span className="text-red-500/80 text-xs font-semibold uppercase tracking-wider">执行失败</span>
            <strong className="text-3xl font-black text-red-600 font-mono tracking-tight">{stats.failedRuns}</strong>
          </div>
          <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-5 flex flex-col gap-1 transition-transform hover:scale-[1.02]">
            <span className="text-blue-600/80 text-xs font-semibold uppercase tracking-wider">P95 响应耗时</span>
            <strong className="text-3xl font-black text-blue-700 font-mono tracking-tight">{stats.p95DurationMs} <span className="text-lg font-medium text-blue-500">ms</span></strong>
          </div>
        </div>
      </section>

      {/* 左栏：活跃任务记录 & 告警 */}
      <div className="flex flex-col gap-6">
        <section className="bg-white/60 backdrop-blur shadow-sm rounded-2xl p-6 ring-1 ring-slate-900/5 flex flex-col">
          <h3 className="text-base font-bold text-slate-800 m-0 mb-4 flex items-center gap-2">
            <span className="w-2 h-6 bg-blue-500 rounded-full inline-block"></span> 活跃常驻任务
          </h3>
          {activeTasks.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-8 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
              <p className="text-slate-400 text-sm">暂无运行中的活跃任务</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3 m-0 p-0 list-none">
              {activeTasks.map(item => (
                <li key={item.taskId} className="group bg-white border border-slate-100 rounded-xl p-4 flex items-center justify-between gap-4 transition-all hover:border-blue-200 hover:shadow-md hover:shadow-blue-900/5">
                  <div className="flex-1 min-w-0">
                    <strong className="text-sm font-bold text-slate-800 block truncate leading-tight">{item.name}</strong>
                    <p className="text-xs text-slate-500 m-0 mt-1.5 flex gap-2">
                      <span className="font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{item.taskId.substring(0, 8)}</span>
                      {item.nextRunAt && <span>下次: {formatTime(item.nextRunAt)}</span>}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 shrink-0 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                    onClick={() => onOpenTask(item.taskId)}
                  >
                    配置详情
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-red-50/30 backdrop-blur shadow-sm rounded-2xl p-6 ring-1 ring-red-900/5">
          <h3 className="text-base font-bold text-red-900 m-0 mb-4 flex items-center gap-2">
            <span className="w-2 h-6 bg-red-500 rounded-full inline-block"></span> 系统告警摘要
          </h3>
          {alerts.length === 0 ? (
            <div className="p-4 bg-green-50/50 rounded-xl border border-green-100 flex items-center gap-3">
              <span className="text-green-500 text-xl">✓</span>
              <p className="text-green-700 text-sm m-0">当前系统运行平稳，无告警项</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2 m-0 p-0 list-none">
              {alerts.slice(0, 6).map(item => (
                <li key={item.alertId} className="bg-white border border-red-100 rounded-lg p-3 text-sm text-slate-700 shadow-sm flex items-start gap-3">
                  <span className={`shrink-0 mt-0.5 w-2 h-2 rounded-full ${item.level === 'error' ? 'bg-red-500' : 'bg-orange-400'}`}></span>
                  <span className="flex-1 leading-snug break-words">
                    <span className="font-bold mr-1 opacity-70">[{item.level.toUpperCase()}]</span> {item.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* 右栏：最近执行日志 */}
      <section className="bg-white/60 backdrop-blur shadow-sm rounded-2xl p-6 ring-1 ring-slate-900/5 lg:row-span-2 flex flex-col">
        <h3 className="text-base font-bold text-slate-800 m-0 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-6 bg-indigo-500 rounded-full inline-block"></span> 最近执行追踪
          </div>
        </h3>
        {recentRuns.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
            <p className="text-slate-400 text-sm">暂无运行记录或记录已清理。</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3 m-0 p-0 list-none flex-1">
            {recentRuns.map(item => (
              <li key={item.runId} className="group relative bg-white border border-slate-100 rounded-xl p-4 flex flex-col gap-3 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-900/5 hover:border-indigo-100 cursor-pointer overflow-hidden" onClick={() => onOpenRun(item.runId)}>
                <div className="absolute top-0 right-0 p-4 opacity-5 translate-x-2 -translate-y-2 transition-transform group-hover:scale-110 group-hover:opacity-10 pointer-events-none">
                  <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>

                <div className="flex items-center justify-between gap-4 pt-1">
                  <strong className="text-sm font-mono text-slate-700 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200/60 z-10">{item.runId.substring(0, 13)}...</strong>
                  <span className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wider z-10
                    ${item.status === 'success' ? 'bg-green-100 text-green-700' :
                      item.status === 'failed' ? 'bg-red-100 text-red-700' :
                        item.status === 'running' ? 'bg-blue-100 text-blue-700 animate-pulse' :
                          'bg-slate-100 text-slate-600'}
                  `}>
                    {formatStatus(item.status)}
                  </span>
                </div>

                <div className="flex items-end justify-between z-10">
                  <div className="text-xs text-slate-500 font-medium">
                    流程节点 <span className="text-indigo-600 font-mono bg-indigo-50 px-1 py-0.5 rounded ml-1">{item.flowId.substring(0, 8)}</span>
                    <div className="mt-1.5 flex items-center gap-1.5 opacity-80">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor hover:text-indigo-500"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {formatTime(item.startedAt)}
                    </div>
                  </div>

                  <button className="bg-slate-900 text-white rounded-lg px-4 py-1.5 text-xs font-bold shadow-md shadow-slate-900/20 opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
                    查看日志 →
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatStatus(status: string): string {
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

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}
