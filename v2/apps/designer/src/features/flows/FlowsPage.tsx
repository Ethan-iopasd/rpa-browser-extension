import { useRef, useState } from "react";

import { createFlowDraft, deleteFlow, ensureSeedFlow, listFlows, loadFlow } from "../../shared/storage/flowStore";
import type { FlowCatalogItem } from "../../shared/types/flow";

type FlowsPageProps = {
  onOpenEditor: (flowId: string) => void;
};

export function FlowsPage(props: FlowsPageProps) {
  const { onOpenEditor } = props;
  const [flows, setFlows] = useState<FlowCatalogItem[]>(() => {
    ensureSeedFlow();
    return listFlows();
  });
  const [keyword, setKeyword] = useState("");
  const [confirmState, setConfirmState] = useState<{
    visible: boolean;
    message: string;
    resolve: ((ok: boolean) => void) | null;
  }>({ visible: false, message: "", resolve: null });
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  function refresh() {
    ensureSeedFlow();
    setFlows(listFlows());
  }

  function createFlow() {
    const created = createFlowDraft();
    onOpenEditor(created.id);
  }

  function showConfirm(message: string): Promise<boolean> {
    return new Promise(resolve => {
      setConfirmState({ visible: true, message, resolve });
      setTimeout(() => confirmButtonRef.current?.focus(), 50);
    });
  }

  function handleConfirmClose(ok: boolean) {
    setConfirmState(previous => {
      previous.resolve?.(ok);
      return { visible: false, message: "", resolve: null };
    });
  }

  async function removeFlow(flowId: string, flowName: string) {
    const target = loadFlow(flowId);
    if (target?.status === "published") {
      alert("已发布流程不能直接删除，请先回退为草稿。");
      return;
    }
    const ok = await showConfirm(`确认删除流程“${flowName}”？此操作不可恢复。`);
    if (!ok) {
      return;
    }
    deleteFlow(flowId);
    refresh();
  }

  const filtered = flows.filter(item => {
    if (!keyword.trim()) {
      return true;
    }
    const text = keyword.toLowerCase();
    return item.name.toLowerCase().includes(text) || item.flowId.toLowerCase().includes(text);
  });

  return (
    <div className="flex flex-col gap-6">
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

      <section className="bg-white/60 backdrop-blur shadow-sm rounded-2xl p-6 ring-1 ring-slate-900/5">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-xl font-bold text-slate-800 m-0 flex items-center gap-2">
              <span className="w-2.5 h-8 bg-gradient-to-b from-blue-400 to-blue-600 rounded-full inline-block"></span>
              自动化流程目录
            </h3>
            <p className="text-sm text-slate-500 m-0 mt-1.5 pl-4">创建并编排你的页面自动化步骤</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 text-sm font-medium transition-colors"
              onClick={refresh}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              刷新列表
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-5 py-2 text-sm font-bold shadow-lg shadow-blue-500/30 transition-all hover:-translate-y-0.5"
              onClick={createFlow}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              新建流程
            </button>
          </div>
        </header>

        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            className="block w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
            placeholder="通过流程名称或 ID 快速检索..."
          />
        </div>
      </section>

      <section>
        {filtered.length === 0 ? (
          <div className="bg-white/40 border border-dashed border-slate-300 rounded-2xl p-12 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-slate-400">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            </div>
            <p className="text-slate-600 font-medium mb-1">未找到匹配流程</p>
            <p className="text-slate-400 text-sm">Try another keyword, or create a new flow from the top right.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map(item => (
              <div
                key={item.flowId}
                className="group relative bg-white border border-slate-200/80 rounded-2xl p-5 flex flex-col gap-4 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-200/50 hover:border-blue-300 cursor-pointer overflow-hidden"
                onClick={() => onOpenEditor(item.flowId)}
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-blue-100/40 to-indigo-50/0 rounded-bl-full -z-10 transition-transform group-hover:scale-150 group-hover:bg-blue-100/60" />

                <div className="flex justify-between items-start">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase backdrop-blur-sm border
                    ${item.status === "published"
                      ? "bg-green-50/80 text-green-700 border-green-200/60"
                      : "bg-amber-50/80 text-amber-700 border-amber-200/60"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${item.status === "published" ? "bg-green-500" : "bg-amber-500"}`}></span>
                    {item.status === "published" ? "已发布 (Published)" : "草稿 (Draft)"}
                  </span>

                  <div className="flex items-center">
                    <button
                      type="button"
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                      onClick={e => {
                        e.stopPropagation();
                        void removeFlow(item.flowId, item.name);
                      }}
                      title="删除流程"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </div>

                <div className="flex-1">
                  <h4 className="text-lg font-bold text-slate-800 m-0 leading-tight group-hover:text-blue-700 transition-colors">{item.name}</h4>
                  <div className="mt-2.5 space-y-1.5 flex flex-col justify-end h-full">
                    <p className="text-xs text-slate-500 m-0 flex items-center justify-between">
                      <span className="font-mono bg-slate-50 px-1.5 py-0.5 rounded text-slate-400 border border-slate-100">ID: {item.flowId.substring(0, 8)}...</span>
                    </p>
                    <p className="text-[11px] text-slate-400 m-0 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      更新于 {new Date(item.updatedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-100/80 flex justify-end">
                  <div className="flex items-center gap-1 font-medium text-sm text-blue-600 group-hover:text-blue-700 opacity-80 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                    进入设计器
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
