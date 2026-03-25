import { useState } from "react";

import type { FlowVersionRecord } from "../types";

type VersionPanelProps = {
  versions: FlowVersionRecord[];
  onSaveDraft: (label?: string) => void;
  onPublish: (label?: string) => void;
  onRollback: (versionId: string) => void;
};

export function VersionPanel(props: VersionPanelProps) {
  const { versions, onSaveDraft, onPublish, onRollback } = props;
  const [label, setLabel] = useState("");

  return (
    <div className="bg-white/80 backdrop-blur shadow-md shadow-slate-200/50 border border-slate-200 rounded-xl flex flex-col overflow-hidden h-full">
      <header className="px-5 py-4 border-b border-slate-100 bg-white flex items-center justify-between sticky top-0 z-10">
        <div>
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 m-0">
            <span className="w-1.5 h-4 bg-emerald-500 rounded-full"></span>
            版本控制
          </h2>
          <p className="text-xs text-slate-400 m-0 mt-1">保存流程快照，支持时间线回滚</p>
        </div>
      </header>

      <div className="p-5 flex flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-3 bg-slate-50 border border-slate-200/60 p-4 rounded-xl">
          <input
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 transition-all focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20 outline-none w-full"
            value={label}
            onChange={event => setLabel(event.target.value)}
            placeholder="为当前修改添加可识别的备注 (例如 '修复登录节点错误')"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex-1 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-sm py-2 px-3 rounded-lg transition-all shadow-sm"
              onClick={() => {
                onSaveDraft(label);
                setLabel("");
              }}
            >
              保存为草稿
            </button>
            <button
              type="button"
              className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm py-2 px-3 rounded-lg transition-all shadow-sm shadow-emerald-500/20"
              onClick={() => {
                onPublish(label);
                setLabel("");
              }}
            >
              发布新版本
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 relative">
          <div className="absolute left-[11px] top-2 bottom-4 w-px bg-slate-200" />
          {versions.length === 0 ? (
            <div className="pl-8 py-3 text-xs text-slate-400 italic">暂无历史版本记录</div>
          ) : null}
          {versions.map(version => (
            <div key={version.id} className="relative pl-8 group">
              <span className={`absolute left-0 top-3.5 w-6 h-6 rounded-full border-2 border-white shadow-sm flex items-center justify-center bg-white z-10 translate-x-[-11px] ${version.mode === 'published' ? 'text-emerald-500 bg-emerald-50' : version.mode === 'draft' ? 'text-slate-400 bg-slate-50' : 'text-amber-500 bg-amber-50'}`}>
                {version.mode === 'published' ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                ) : version.mode === 'rollback' ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                ) : (
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                )}
              </span>
              <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between hover:border-slate-300 hover:shadow-sm transition-all">
                <div className="flex flex-col gap-1 min-w-0 pr-3">
                  <strong className="text-sm font-bold text-slate-800 truncate">{version.label || "未命名版本"}</strong>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium opacity-80">
                    <span className={`px-1.5 py-0.5 rounded uppercase tracking-wider ${version.mode === 'published' ? 'bg-emerald-100 text-emerald-700' : version.mode === 'draft' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700'}`}>
                      {formatMode(version.mode)}
                    </span>
                    <span className="text-slate-500 font-mono">
                      {new Date(version.createdAt).toLocaleString("zh-CN", { hour12: false, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-xs font-bold text-slate-600 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 px-3 py-1.5 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                  onClick={() => onRollback(version.id)}
                >
                  回滚至此
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatMode(mode: FlowVersionRecord["mode"]): string {
  if (mode === "draft") {
    return "草稿";
  }
  if (mode === "published") {
    return "已发布";
  }
  return "回滚";
}
