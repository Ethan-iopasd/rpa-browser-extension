import type { FlowEdge } from "@rpa/flow-schema/generated/types";

type EdgePanelProps = {
  selectedEdge: FlowEdge | null;
  onUpdateEdge: (edgeId: string, patch: Partial<FlowEdge>) => void;
  onRemoveEdge: (edgeId: string) => void;
};

export function EdgePanel(props: EdgePanelProps) {
  const { selectedEdge, onUpdateEdge, onRemoveEdge } = props;

  if (!selectedEdge) {
    return (
      <div className="bg-white/60 backdrop-blur border border-slate-200 shadow-sm rounded-xl p-6 flex flex-col items-center justify-center text-center min-h-[160px]">
        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3 text-slate-300">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
        </div>
        <h3 className="text-slate-800 font-bold text-sm mb-1">未选中连线</h3>
        <p className="text-slate-500 text-xs text-balance">在画布中点击连线，可在此修改条件或删除</p>
      </div>
    );
  }

  return (
    <div className="bg-white/80 backdrop-blur shadow-md shadow-slate-200/50 border border-slate-200 rounded-xl flex flex-col overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-100 bg-white flex items-center justify-between sticky top-0 z-10">
        <div>
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 m-0">
            <span className="w-1.5 h-4 bg-purple-500 rounded-full"></span>
            连线属性
          </h2>
          <p className="text-xs text-slate-400 m-0 mt-1">控制流程分支走向的重要设置</p>
        </div>
        <button
          type="button"
          className="text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 p-2 rounded-lg transition-colors"
          onClick={() => onRemoveEdge(selectedEdge.id)}
          title="移除连线"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
        </button>
      </header>

      <div className="p-5 flex flex-col gap-4 overflow-y-auto">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-slate-600">ID</span>
          <input className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-500 font-mono focus:outline-none" value={selectedEdge.id} disabled />
        </label>

        <div className="flex items-center gap-2">
          <label className="flex flex-col gap-1.5 flex-1 w-0">
            <span className="text-xs font-bold text-slate-600">源始节点</span>
            <input className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-500 font-mono truncate focus:outline-none" value={selectedEdge.source.substring(0, 8)} title={selectedEdge.source} disabled />
          </label>

          <svg className="w-5 h-5 text-slate-300 shrink-0 mt-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>

          <label className="flex flex-col gap-1.5 flex-1 w-0">
            <span className="text-xs font-bold text-slate-600">目标节点</span>
            <input className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-500 font-mono truncate focus:outline-none" value={selectedEdge.target.substring(0, 8)} title={selectedEdge.target} disabled />
          </label>
        </div>

        <div className="h-px bg-slate-100 my-1 w-full" />

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-purple-600 flex items-center gap-1.5">
            判断条件 (可选)
            <span className="text-[10px] bg-purple-50 text-purple-600 px-1 py-0.5 rounded border border-purple-100 font-normal">If / Switch 分支</span>
          </span>
          <input
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm transition-all focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 outline-none font-mono placeholder:text-slate-300"
            value={selectedEdge.condition ?? ""}
            onChange={event =>
              onUpdateEdge(selectedEdge.id, { condition: event.target.value.trim() || undefined })
            }
            placeholder="例如: true / false / success"
          />
        </label>
      </div>
    </div>
  );
}
