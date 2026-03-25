import { useMemo, useState } from "react";

import type { FlowModel } from "@rpa/flow-schema/generated/types";

type VariablesPanelProps = {
  flow: FlowModel;
  onSetVariable: (key: string, value: string) => void;
  onRemoveVariable: (key: string) => void;
};

export function VariablesPanel(props: VariablesPanelProps) {
  const { flow, onSetVariable, onRemoveVariable } = props;
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");

  const variables = useMemo(() => Object.entries(flow.variables ?? {}), [flow.variables]);
  const browserMode = useMemo(() => {
    const raw = flow.variables?._browserMode;
    if (raw === "auto" || raw === "simulate" || raw === "real") {
      return raw;
    }
    return "real";
  }, [flow.variables]);
  const browserHeadless = useMemo(() => {
    const raw = flow.variables?._browserHeadless;
    return typeof raw === "boolean" ? raw : false;
  }, [flow.variables]);

  function submitVariable() {
    if (!draftKey.trim()) {
      return;
    }
    onSetVariable(draftKey, draftValue);
    setDraftKey("");
    setDraftValue("");
  }

  return (
    <div className="bg-white/80 backdrop-blur shadow-md shadow-slate-200/50 border border-slate-200 rounded-xl flex flex-col overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-100 bg-white flex items-center justify-between sticky top-0 z-10">
        <div>
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 m-0">
            <span className="w-1.5 h-4 bg-teal-500 rounded-full"></span>
            全局变量
          </h2>
          <p className="text-xs text-slate-400 m-0 mt-1">可在节点中通过 <code className="text-indigo-500 bg-indigo-50 px-1 py-0.5 rounded">{'{{变量名}}'}</code> 引用</p>
        </div>
      </header>

      <div className="p-5 flex flex-col gap-5 overflow-y-auto">
        <div className="flex flex-col gap-4 bg-slate-50 border border-slate-200/60 p-4 rounded-xl">
          <h3 className="text-xs font-bold text-teal-600 uppercase tracking-wider m-0 flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            运行环境设置
          </h3>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">浏览器模式</span>
            <select
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 transition-all focus:border-teal-400 focus:ring-2 focus:ring-teal-500/20 outline-none"
              value={browserMode}
              onChange={event => onSetVariable("_browserMode", event.target.value)}
            >
              <option value="real">真实浏览器 (Real)</option>
              <option value="auto">自动检测 (Auto)</option>
              <option value="simulate">模拟执行 (Simulate)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">无头模式 (后台静默)</span>
            <select
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 transition-all focus:border-teal-400 focus:ring-2 focus:ring-teal-500/20 outline-none"
              value={browserHeadless ? "true" : "false"}
              onChange={event => onSetVariable("_browserHeadless", event.target.value)}
            >
              <option value="false">显示浏览器窗口 (默认)</option>
              <option value="true">开启静默模式 (强相关)</option>
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="bg-slate-50 border border-slate-200 rounded-lg flex flex-col flex-1 divide-y divide-slate-100 overflow-hidden focus-within:ring-2 focus-within:ring-teal-500/20 focus-within:border-teal-400 transition-all">
              <input
                className="px-3 py-2 text-xs bg-transparent border-none outline-none font-medium placeholder:text-slate-400 text-slate-700"
                value={draftKey}
                onChange={event => setDraftKey(event.target.value)}
                placeholder="变量名称 (例如: apiUrl)"
              />
              <input
                className="px-3 py-2 text-xs bg-transparent border-none outline-none text-slate-600 placeholder:text-slate-400"
                value={draftValue}
                onChange={event => setDraftValue(event.target.value)}
                placeholder="变量默认值"
                onKeyDown={e => e.key === 'Enter' && submitVariable()}
              />
            </div>
            <button
              type="button"
              className="shrink-0 w-10 h-10 rounded-lg bg-teal-500 hover:bg-teal-600 text-white flex items-center justify-center transition-all shadow-md shadow-teal-500/20 flex-col"
              onClick={submitVariable}
              title="添加变量"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            </button>
          </div>
        </div>

        {variables.length > 0 ? (
          <ul className="flex flex-col gap-2 m-0 p-0 list-none">
            {variables.map(([key, value]) => (
              <li key={key} className="group flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-white hover:border-teal-300 hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer">
                <div className="flex flex-col overflow-hidden min-w-0 pr-2">
                  <strong className="text-sm text-slate-800 truncate font-mono">{key}</strong>
                  <span className="text-xs text-slate-500 truncate mt-0.5 bg-slate-50 px-1 py-0.5 rounded border border-slate-100 inline-block w-fit max-w-full">{String(value)}</span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    type="button"
                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="编辑变量"
                    onClick={() => {
                      setDraftKey(key);
                      setDraftValue(String(value));
                    }}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                  <button
                    type="button"
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="删除变量"
                    onClick={() => onRemoveVariable(key)}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center p-6 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            <p className="text-xs text-slate-400 m-0">暂无自定义变量</p>
          </div>
        )}
      </div>
    </div>
  );
}
