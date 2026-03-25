import { useCallback, useEffect, useMemo, useState } from "react";

import type { RunEvent } from "@rpa/flow-schema/generated/types";

import { getRunEventsRequest, getRunRequest } from "../../core/api/runs";
import type { RunRecord } from "../../core/api/runs";
import { loadFlow, saveFlow } from "../../shared/storage/flowStore";
import { detectRunFailureHint } from "../../shared/utils/runFailure";

type RunDetailPageProps = {
  runId: string;
  onOpenFlowEditor: (flowId: string) => void;
};

export function RunDetailPage(props: RunDetailPageProps) {
  const { runId, onOpenFlowEditor } = props;
  const [run, setRun] = useState<RunRecord | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [level, setLevel] = useState("");
  const [eventPage, setEventPage] = useState(1);
  const [eventPageSize, setEventPageSize] = useState(100);
  const [panelError, setPanelError] = useState("");

  const eventOffset = (eventPage - 1) * eventPageSize;
  const eventTotalPages = Math.max(1, Math.ceil(eventsTotal / eventPageSize));

  const refresh = useCallback(async () => {
    setLoading(true);
    setPanelError("");
    try {
      const [runRes, eventsRes] = await Promise.all([
        getRunRequest(runId),
        getRunEventsRequest(runId, {
          level: level || undefined,
          keyword: keyword || undefined,
          limit: eventPageSize,
          offset: eventOffset
        })
      ]);
      if (!runRes.ok) {
        setPanelError(`${runRes.error.code}: ${runRes.error.message}`);
        return;
      }
      if (!eventsRes.ok) {
        setPanelError(`${eventsRes.error.code}: ${eventsRes.error.message}`);
        return;
      }
      setRun(runRes.data);
      setEvents(eventsRes.data.events);
      setEventsTotal(eventsRes.data.total);
    } finally {
      setLoading(false);
    }
  }, [eventOffset, eventPageSize, keyword, level, runId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setEventPage(1);
  }, [keyword, level, runId]);

  useEffect(() => {
    if (eventPage > eventTotalPages) {
      setEventPage(eventTotalPages);
    }
  }, [eventPage, eventTotalPages]);

  const groupedErrors = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of events) {
      const code = event.data?.errorCode;
      if (typeof code === "string") {
        map.set(code, (map.get(code) || 0) + 1);
      }
    }
    return Array.from(map.entries()).map(([code, count]) => ({ code, count }));
  }, [events]);

  const failureHint = useMemo(() => detectRunFailureHint(events, run, panelError), [events, run, panelError]);

  function openFlowEditorFromRun(target: RunRecord) {
    if (target.flowSnapshot) {
      saveFlow(target.flowSnapshot, "draft");
      onOpenFlowEditor(target.flowSnapshot.id);
      return;
    }
    const local = loadFlow(target.flowId);
    if (local) {
      onOpenFlowEditor(target.flowId);
      return;
    }
    setPanelError("该运行实例缺少流程快照，且本地未找到对应流程，无法打开流程编排设计器。");
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/60 backdrop-blur p-5 rounded-2xl border border-slate-200/60 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-500 flex items-center justify-center shadow-sm">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 m-0">运行实例详情透视全景</h2>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm text-slate-500 m-0">深入排查运行轨迹与执行日志</p>
              <span className="bg-slate-100 text-slate-500 font-mono text-[10px] px-1.5 py-0.5 rounded border border-slate-200">{runId}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {run && (
            <button
              type="button"
              className="text-white hover:text-white bg-indigo-500 hover:bg-indigo-600 px-4 py-2 border border-indigo-600 rounded-lg text-sm font-bold transition-all shadow-sm shadow-indigo-500/20"
              onClick={() => openFlowEditorFromRun(run)}
            >
              唤醒流程编排设计器
            </button>
          )}
          <button
            type="button"
            className="text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold transition-all"
            onClick={() => void refresh()}
            disabled={loading}
            title="刷新全量状态"
          >
            {loading ? (
              <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Meta Section */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <div className="bg-white/80 backdrop-blur shadow-sm shadow-slate-200/50 border border-slate-200 rounded-2xl p-5 flex flex-col gap-4">
            <h3 className="m-0 text-sm font-bold text-slate-800 border-b border-slate-100 pb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              元数据指标
            </h3>
            {run ? (
              <dl className="flex flex-col gap-3.5 m-0 text-sm">
                <div className="flex flex-col gap-1">
                  <dt className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">原始模型</dt>
                  <dd className="m-0 font-mono text-slate-700 bg-slate-50 px-2.5 py-1 rounded w-fit border border-slate-100">{run.flowId}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">调度归属任务</dt>
                  <dd className="m-0 font-mono text-slate-700 bg-slate-50 px-2.5 py-1 rounded w-fit border border-slate-100">{run.taskId ?? <span className="text-slate-400 italic font-sans">非任务调度触发 (-无-)</span>}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">终端执行状态</dt>
                  <dd className="m-0">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${run.status === "success" ? "bg-emerald-50 text-emerald-600 border-emerald-200" : run.status === "failed" ? "bg-rose-50 text-rose-600 border-rose-200" : run.status === "running" ? "bg-sky-50 text-sky-600 border-sky-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${run.status === "success" ? "bg-emerald-500" : run.status === "failed" ? "bg-rose-500" : run.status === "running" ? "bg-sky-500 animate-pulse" : "bg-slate-400"}`} />
                      {formatRunStatus(run.status)}
                    </span>
                  </dd>
                </div>
                <div className="border-t border-slate-100 pt-3 flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <dt className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">启动执行时刻</dt>
                    <dd className="m-0 font-mono text-slate-600 text-xs">{new Date(run.startedAt).toLocaleString("zh-CN", { hour12: false })}</dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">执行终止时刻</dt>
                    <dd className="m-0 font-mono text-slate-600 text-xs">{run.finishedAt ? new Date(run.finishedAt).toLocaleString("zh-CN", { hour12: false }) : <span className="text-slate-400 italic border-b border-dashed border-slate-300 pb-0.5">未完结 / 仍在运行</span>}</dd>
                  </div>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-slate-500 m-0 italic py-4">读取缓存数据失败系统无内容载入。</p>
            )}
          </div>

          <div className="bg-white/80 backdrop-blur shadow-sm shadow-slate-200/50 border border-slate-200 rounded-2xl p-5 flex flex-col gap-4">
            <h3 className="m-0 text-sm font-bold text-slate-800 border-b border-slate-100 pb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              智能诊断与异常聚类
            </h3>
            {failureHint ? (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex gap-3 items-start relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-rose-400 to-rose-600" />
                <div className="flex flex-col gap-1.5 w-full text-rose-800">
                  <strong className="text-sm font-bold">{failureHint.title}</strong>
                  <p className="text-xs opacity-80 m-0">{failureHint.description}</p>
                  <div className="flex flex-col gap-1 mt-2 text-xs">
                    <span className="font-bold flex gap-1 items-center bg-white/60 p-1.5 rounded border border-rose-100"><span className="opacity-50">排查建议:</span> {failureHint.suggestion}</span>
                    <span className="font-mono mt-1 opacity-70">ErrCode: {failureHint.code}</span>
                  </div>
                </div>
              </div>
            ) : null}
            {groupedErrors.length === 0 ? (
              <div className="bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-lg p-3 text-xs font-bold flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                当前实例运行状况良好未发现致命异常中断。
              </div>
            ) : (
              <ul className="flex flex-col gap-2 m-0 p-0 list-none">
                {groupedErrors.map(item => (
                  <li key={item.code} className="flex items-center justify-between text-xs bg-slate-50 border border-slate-200 p-2.5 rounded-lg">
                    <strong className="font-mono text-rose-600 bg-rose-50 px-1 py-0.5 rounded border border-rose-100">{item.code}</strong>
                    <span className="font-bold text-slate-500 bg-white px-2 py-0.5 rounded-full border border-slate-200 shadow-sm">{item.count} 命中波及</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Events Console Data Section */}
        <div className="lg:col-span-2 flex flex-col h-[700px]">
          <div className="bg-[#1e1e1e] border border-slate-800 rounded-2xl shadow-xl overflow-hidden flex flex-col h-full ring-1 ring-white/10">
            {/* Terminal Header Action Bar */}
            <header className="px-4 py-3 border-b border-[#333] bg-[#252526] flex items-center justify-between select-none shrink-0">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-rose-500" />
                  <span className="w-3 h-3 rounded-full bg-amber-500" />
                  <span className="w-3 h-3 rounded-full bg-emerald-500" />
                </span>
                <h3 className="ml-3 m-0 text-xs font-mono text-slate-300 font-bold uppercase tracking-wider">Tty::Console Event Stream</h3>
              </div>
              <div className="flex items-center gap-2">
                <select
                  className="px-2 py-1.5 bg-[#333] border border-[#444] rounded text-xs text-slate-300 font-mono outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  value={level}
                  onChange={event => setLevel(event.target.value)}
                >
                  <option value="">*</option>
                  <option value="error">ERROR</option>
                  <option value="warn">WARN</option>
                  <option value="info">INFO</option>
                  <option value="debug">DEBUG</option>
                </select>
                <div className="relative">
                  <input
                    className="px-2 py-1.5 pl-7 w-32 focus:w-48 bg-[#333] border border-[#444] rounded text-xs text-slate-300 font-mono outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-500"
                    value={keyword}
                    onChange={event => setKeyword(event.target.value)}
                    placeholder="/grep keyword"
                  />
                  <svg className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                </div>
                <select
                  className="px-2 py-1.5 bg-[#333] border border-[#444] rounded text-xs text-slate-300 font-mono outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  value={eventPageSize}
                  onChange={event => {
                    setEventPageSize(Number(event.target.value));
                    setEventPage(1);
                  }}
                >
                  <option value={50}>50/页</option>
                  <option value={100}>100/页</option>
                  <option value={200}>200/页</option>
                </select>
                <button
                  type="button"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white p-1.5 rounded transition-colors"
                  onClick={() => void refresh()}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </button>
              </div>
            </header>

            {panelError ? <div className="p-3 bg-rose-900 border-b border-rose-800 text-rose-200 text-xs font-mono">{panelError}</div> : null}

            {/* Terminal Output */}
            <div className="flex-1 overflow-auto bg-[#1e1e1e] p-0 m-0">
              {events.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full p-8 text-slate-500">
                  <svg className="w-8 h-8 mb-3 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 9l3 3-3 3m5 0h3M4 17h16a2 2 0 002-2V9a2 2 0 00-2-2H4a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>
                  <span className="font-mono text-xs opacity-50">~ EOF (No traces found)</span>
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-[11px] font-mono">
                  <thead className="sticky top-0 bg-[#2d2d2d] shadow-sm z-10 text-slate-400">
                    <tr>
                      <th className="py-2 px-4 font-normal w-24">TIMESTAMP</th>
                      <th className="py-2 px-4 font-normal w-[80px]">LVL</th>
                      <th className="py-2 px-4 font-normal w-40">NODE::SYS</th>
                      <th className="py-2 px-4 font-normal">EXEC_STDOUT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {events.map(item => {
                      let levelColor = "text-sky-400";
                      if (item.level === "error") levelColor = "text-rose-400 font-bold bg-rose-500/10";
                      else if (item.level === "warn") levelColor = "text-amber-400";
                      else if (item.level === "debug") levelColor = "text-slate-500";
                      else if ((item.level as string) === "success") levelColor = "text-emerald-400";

                      return (
                        <tr key={item.eventId} className={`hover:bg-white/5 transition-colors ${levelColor}`}>
                          <td className="py-1.5 px-4 tabular-nums opacity-60 whitespace-nowrap align-top">{new Date(item.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}</td>
                          <td className="py-1.5 px-4 font-bold uppercase tracking-wider align-top">{item.level}</td>
                          <td className="py-1.5 px-4 align-top">
                            <div className="flex flex-col gap-0.5 max-w-[150px]">
                              <span className="truncate" title={item.nodeId}>{item.nodeId || '-'}</span>
                              {item.nodeType && <span className="text-[9px] px-1 py-[1px] rounded bg-[#333] border border-[#444] opacity-80 uppercase leading-none w-fit tracking-wide">{item.nodeType}</span>}
                            </div>
                          </td>
                          <td className="py-1.5 px-4 break-words font-medium">{item.message}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="shrink-0 px-4 py-2 border-t border-[#333] bg-[#252526] flex items-center justify-between text-xs text-slate-300">
              <span>
                日志总数 {eventsTotal}，第 {eventPage}/{eventTotalPages} 页
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="px-2 py-1 rounded border border-[#444] disabled:opacity-40"
                  disabled={eventPage <= 1 || loading}
                  onClick={() => setEventPage(previous => Math.max(1, previous - 1))}
                >
                  上一页
                </button>
                <button
                  type="button"
                  className="px-2 py-1 rounded border border-[#444] disabled:opacity-40"
                  disabled={eventPage >= eventTotalPages || loading}
                  onClick={() => setEventPage(previous => Math.min(eventTotalPages, previous + 1))}
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatRunStatus(status: string): string {
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
