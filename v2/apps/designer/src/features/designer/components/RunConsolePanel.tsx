import { useEffect, useMemo, useState } from "react";

import type { RunEvent } from "@rpa/flow-schema/generated/types";

import { detectRunFailureHint } from "../../../shared/utils/runFailure";
import type { ValidationState } from "../types";

const PAGE_SIZE_OPTIONS = [50, 100, 200];

type RunConsolePanelProps = {
  validationState: ValidationState;
  validationErrors: string[];
  runState: unknown;
  runEvents: RunEvent[];
  runOptions: {
    maxSteps: number;
    defaultTimeoutMs: number;
    defaultMaxRetries: number;
    breakpointNodeIds: string[];
    pauseAfterEachNode: boolean;
  };
  panelMessage: string;
  panelError: string;
  isValidating: boolean;
  isRunning: boolean;
  onSetRunOptions: (patch: {
    maxSteps?: number;
    defaultTimeoutMs?: number;
    defaultMaxRetries?: number;
    breakpointNodeIds?: string[];
    pauseAfterEachNode?: boolean;
  }) => void;
  onValidate: () => Promise<void>;
  onRun: () => Promise<string | null>;
  onRunOfflineSelfCheck: () => Promise<string | null>;
  onLocateNode: (nodeId: string) => void;
  onClearPanelMessage: () => void;
};

export function RunConsolePanel(props: RunConsolePanelProps) {
  const {
    validationState,
    validationErrors,
    runState,
    runEvents,
    runOptions,
    panelMessage,
    panelError,
    isValidating,
    isRunning,
    onSetRunOptions,
    onValidate,
    onRun,
    onRunOfflineSelfCheck,
    onLocateNode,
    onClearPanelMessage
  } = props;

  const hasValidationPass = Boolean(validationState && "valid" in validationState && validationState.valid);
  const failureHint = detectRunFailureHint(runEvents, runState, panelError);
  const [eventPage, setEventPage] = useState(1);
  const [eventPageSize, setEventPageSize] = useState(100);
  const eventTotal = runEvents.length;
  const eventTotalPages = Math.max(1, Math.ceil(eventTotal / eventPageSize));
  const pagedEvents = useMemo(() => {
    const offset = (eventPage - 1) * eventPageSize;
    return runEvents.slice(offset, offset + eventPageSize);
  }, [eventPage, eventPageSize, runEvents]);

  useEffect(() => {
    if (eventPage > eventTotalPages) {
      setEventPage(eventTotalPages);
    }
  }, [eventPage, eventTotalPages]);

  useEffect(() => {
    setEventPage(1);
  }, [runEvents]);

  return (
    <div className="bg-white/95 backdrop-blur shadow-2xl shadow-slate-900/20 border border-slate-200 rounded-xl flex flex-col overflow-hidden">
      <header className="px-5 py-3 border-b border-slate-100 bg-white flex items-center justify-between sticky top-0 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 m-0">
            <span className="flex w-5 h-5 bg-indigo-100 text-indigo-500 rounded items-center justify-center">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 9l3 3-3 3m5 0h3M4 17h16a2 2 0 002-2V9a2 2 0 00-2-2H4a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>
            </span>
            运行与自测
          </h2>
          <div className="hidden sm:flex items-center gap-2 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full text-xs font-medium text-slate-500">
            <span className={`w-2 h-2 rounded-full ${hasValidationPass ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-amber-400"}`} />
            {hasValidationPass ? "校验已通过" : "待校验 / 有告警"}
          </div>
          {panelMessage ? (
            <button type="button" className="text-xs bg-sky-50 text-sky-600 px-2.5 py-1 rounded-full border border-sky-100 font-medium hover:bg-sky-100 transition-colors truncate max-w-[200px]" onClick={onClearPanelMessage} title="点击清除消息">
              {panelMessage}
            </button>
          ) : null}
          {panelError ? <span className="text-xs text-rose-600 font-bold flex items-center gap-1"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>{panelError}</span> : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
            disabled={isValidating}
            onClick={() => void onValidate()}
          >
            {isValidating ? "校验中..." : "重新校验"}
          </button>
          <button
            type="button"
            className="text-white hover:text-white bg-indigo-500 hover:bg-indigo-600 border border-indigo-600 px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50 shadow-sm"
            disabled={isRunning}
            onClick={() => void onRunOfflineSelfCheck()}
          >
            {isRunning ? "自测运行中..." : "使用本地浏览器自测"}
          </button>
          <button
            type="button"
            className="text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
            disabled={isRunning}
            onClick={() => void onRun()}
          >
            {isRunning ? "发送中..." : "云端执行"}
          </button>
        </div>
      </header>

      {failureHint && (
        <div className="mx-5 my-4 bg-rose-50 border border-rose-200 rounded-xl p-4 flex gap-3 items-start relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-rose-400 to-rose-600" />
          <div className="w-8 h-8 rounded-full bg-rose-100 text-rose-500 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          </div>
          <div className="flex flex-col gap-1.5">
            <strong className="text-sm text-rose-800 font-bold">{failureHint.title}</strong>
            <p className="text-xs text-rose-700/80 m-0">{failureHint.description}</p>
            {failureHint.suggestion && (
              <div className="mt-2 text-xs font-medium text-slate-800 bg-white/60 p-2 rounded border border-rose-100 flex items-start gap-1.5">
                <svg className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                <span>建议: {failureHint.suggestion}</span>
              </div>
            )}
            <div className="flex items-center gap-3 mt-1 text-[11px] text-rose-500 font-mono">
              {failureHint.code && <span>Code: {failureHint.code}</span>}
              {failureHint.nodeId && <span className="bg-rose-100 px-1 py-0.5 rounded">Node: {failureHint.nodeId}</span>}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-5 p-5 bg-slate-50/50">
        {/* Settings & Validations */}
        <div className="flex flex-col gap-5 w-full lg:w-1/3 shrink-0">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider m-0">执行选项 (Run Options)</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-slate-500">最大步数</span>
                <input className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded flex-1 w-full text-xs font-mono text-slate-700 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500/20 transition-all" type="number" min={1} value={runOptions.maxSteps} onChange={event => onSetRunOptions({ maxSteps: Number(event.target.value) })} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-slate-500">默认超时 (ms)</span>
                <input className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded flex-1 w-full text-xs font-mono text-slate-700 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500/20 transition-all" type="number" min={1} value={runOptions.defaultTimeoutMs} onChange={event => onSetRunOptions({ defaultTimeoutMs: Number(event.target.value) })} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-slate-500">默认重试次</span>
                <input className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded flex-1 w-full text-xs font-mono text-slate-700 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500/20 transition-all" type="number" min={0} value={runOptions.defaultMaxRetries} onChange={event => onSetRunOptions({ defaultMaxRetries: Number(event.target.value) })} />
              </label>
              <label className="flex flex-col gap-1.5 relative">
                <span className="text-[10px] font-bold text-slate-500">调试单步模式</span>
                <select className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded flex-1 w-full text-xs font-mono text-slate-700 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500/20 transition-all appearance-none" value={runOptions.pauseAfterEachNode ? "true" : "false"} onChange={event => onSetRunOptions({ pauseAfterEachNode: event.target.value === "true" })}>
                  <option value="false">Off</option>
                  <option value="true">On</option>
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1.5 hidden">
              <span className="text-[10px] font-bold text-slate-500">断点节点 IDs (逗号分隔)</span>
              <input className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded w-full text-xs font-mono text-slate-700 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500/20 transition-all" value={runOptions.breakpointNodeIds.join(",")} onChange={event => onSetRunOptions({ breakpointNodeIds: event.target.value.split(",").map(item => item.trim()).filter(Boolean) })} placeholder="n_login,n_submit" />
            </label>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3 min-h-[160px] max-h-[300px] overflow-auto">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider m-0">校验结果诊断</h3>
            {validationErrors.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
                <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center mb-2"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg></div>
                <span className="text-xs font-bold text-emerald-700">配置完全无误</span>
              </div>
            ) : (
              <ul className="flex flex-col gap-2 m-0 p-0 list-none">
                {validationErrors.map((item, index) => {
                  const nodeId = parseNodeIdFromError(item);
                  return (
                    <li key={`${item}_${index}`} className="group flex flex-col gap-1 p-2 rounded-lg bg-rose-50 border border-rose-100">
                      <span className="text-xs font-medium text-rose-800 leading-tight">{item}</span>
                      {nodeId ? (
                        <button type="button" className="self-start text-[10px] font-bold text-indigo-600 hover:text-indigo-800 underline underline-offset-2 mt-1 transition-colors" onClick={() => onLocateNode(nodeId)}>
                          定位并修改节点 {nodeId}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Event Logs */}
        <div className="flex-1 flex flex-col min-w-0 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden h-full max-h-[500px]">
          <header className="px-4 py-2 border-b border-slate-100 bg-slate-50 select-none">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider m-0">执行过程日志跟踪 (Events)</h3>
          </header>
          <div className="flex-1 overflow-auto bg-[#1e1e1e] text-slate-300 font-mono text-[11px] p-0 m-0">
            {runEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-slate-500">
                <svg className="w-8 h-8 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M4 17h16a2 2 0 002-2V9a2 2 0 00-2-2H4a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>
                <span>尚未产生任何执行日志</span>
                <span className="text-[10px] mt-1 opacity-70">点击上方执行按钮开始运行</span>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[#2d2d2d] shadow-sm z-10 text-slate-400">
                  <tr>
                    <th className="py-2 px-4 font-normal w-24">时间</th>
                    <th className="py-2 px-4 font-normal w-16">级别</th>
                    <th className="py-2 px-4 font-normal w-32">节点</th>
                    <th className="py-2 px-4 font-normal">消息内容</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {pagedEvents.map(event => {
                    let levelColor = "text-sky-400";
                    if ((event.level as string) === "error" || (event.level as string) === "fatal") levelColor = "text-rose-400 font-bold bg-rose-500/10";
                    else if ((event.level as string) === "warn") levelColor = "text-amber-400";
                    else if ((event.level as string) === "debug") levelColor = "text-slate-500";
                    else if ((event.level as string) === "success") levelColor = "text-emerald-400";

                    return (
                      <tr key={event.eventId} className={`hover:bg-white/5 transition-colors ${levelColor}`}>
                        <td className="py-1.5 px-4 tabular-nums opacity-70 whitespace-nowrap">{formatTime(event.timestamp)}</td>
                        <td className="py-1.5 px-4 font-bold uppercase text-[9px] tracking-wider">{event.level}</td>
                        <td className="py-1.5 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate max-w-[100px]" title={event.nodeId}>{event.nodeId || '-'}</span>
                            {event.nodeType && <span className="text-[9px] px-1 py-0.5 rounded border border-white/20 opacity-80 uppercase leading-none">{event.nodeType}</span>}
                          </div>
                        </td>
                        <td className="py-1.5 px-4 break-words">
                          {renderEventMessage(event)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between gap-3 text-xs">
            <div className="text-slate-600">
              共 {eventTotal} 条，第 {eventPage} / {eventTotalPages} 页
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-slate-600">
                每页
                <select
                  className="px-2 py-1 border border-slate-300 rounded"
                  value={eventPageSize}
                  onChange={event => {
                    setEventPageSize(Number(event.target.value));
                    setEventPage(1);
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
                className="px-2 py-1 rounded border border-slate-300 text-slate-700 disabled:opacity-50"
                disabled={eventPage <= 1}
                onClick={() => setEventPage(previous => Math.max(1, previous - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded border border-slate-300 text-slate-700 disabled:opacity-50"
                disabled={eventPage >= eventTotalPages}
                onClick={() => setEventPage(previous => Math.min(eventTotalPages, previous + 1))}
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

function parseNodeIdFromError(message: string): string | null {
  const matchers = [/Node\s+([A-Za-z0-9_-]+)/, /node\s+([A-Za-z0-9_-]+)/, /节点\s+([A-Za-z0-9_-]+)/];
  for (const matcher of matchers) {
    const match = message.match(matcher);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function renderEventMessage(event: RunEvent): string {
  const errorCode = event.data?.errorCode;
  if (typeof errorCode === "string") {
    return `${event.message} [${errorCode}]`;
  }
  return event.message;
}
