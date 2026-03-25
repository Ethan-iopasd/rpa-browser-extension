import { useMemo, useState } from "react";

import type { FlowModel } from "@rpa/flow-schema/generated/types";

import { isDesktopRuntime } from "../../shared/desktop/bridge";
import { EdgePanel } from "./components/EdgePanel";
import { NodePanel } from "./components/NodePanel";
import { ReactFlowCanvas } from "./components/ReactFlowCanvas";
import { RecorderImportPanel } from "./components/RecorderImportPanel";
import { TaskCenterPanel } from "./components/TaskCenterPanel";
import { VariablesPanel } from "./components/VariablesPanel";
import { VersionPanel } from "./components/VersionPanel";
import { useDesignerState } from "./hooks/useDesignerState";

type DesignerPageProps = {
  initialFlow?: FlowModel;
  onFlowChange?: (flow: FlowModel) => void;
  showTaskCenter?: boolean;
  autoSaveStatusText?: string;
  autoSaveState?: "idle" | "saving" | "saved" | "error";
};

export function DesignerPage(props: DesignerPageProps) {
  const {
    initialFlow,
    onFlowChange,
    showTaskCenter = true,
    autoSaveStatusText,
    autoSaveState = "idle"
  } = props;
  const { state, actions, selectedNode, errorNodeIds, validationErrors } = useDesignerState({
    initialFlow,
    onFlowChange,
    enableTaskCenter: showTaskCenter
  });
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [nodeDrawerFlowId, setNodeDrawerFlowId] = useState("");
  const [nodeDrawerOpen, setNodeDrawerOpen] = useState(false);
  const isDesktop = useMemo(() => isDesktopRuntime(), []);
  const extensionBridgeEnabled = !isDesktop;
  const extensionBridgeHint = "桌面端不支持浏览器扩展直连。请在浏览器中录制后导出 JSON，再回到桌面端导入。";
  const showNodeDrawer = nodeDrawerOpen && nodeDrawerFlowId === state.flow.id;

  const selectedEdge = useMemo(
    () => state.flow.edges.find(edge => edge.id === state.selectedEdgeId) ?? null,
    [state.flow.edges, state.selectedEdgeId]
  );

  function handleSelectNode(nodeId: string | null) {
    actions.selectNode(nodeId);
    setNodeDrawerFlowId(state.flow.id);
    setNodeDrawerOpen(Boolean(nodeId));
  }

  function handleSelectEdge(edgeId: string | null) {
    actions.selectEdge(edgeId);
    if (edgeId) {
      setNodeDrawerOpen(false);
    }
  }

  function closeNodeDrawer() {
    setNodeDrawerOpen(false);
    actions.selectNode(null);
  }

  function runNow() {
    void actions.runFlow();
  }

  const autoSaveStatusClass =
    autoSaveState === "error"
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : autoSaveState === "saving"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : autoSaveState === "saved"
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-slate-100 text-slate-500 border-slate-200";

  return (
    <main className="flex flex-col h-[calc(100vh-80px)] overflow-hidden gap-4">
      <section className="bg-white/80 backdrop-blur-md border border-slate-200 shadow-sm rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 z-10">
        <div className="flex flex-col">
          <h1 className="text-xl font-bold text-slate-800 m-0 flex items-center gap-2">
            <span className="w-2.5 h-6 bg-indigo-500 rounded-full inline-block"></span>
            流程设计器
            <span className="bg-slate-100 text-slate-500 text-[10px] px-2 py-0.5 rounded-full font-mono font-medium border border-slate-200 shrink-0 ml-1">
              {state.flow.id.substring(0, 8)}...
            </span>
            {autoSaveStatusText ? (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border shrink-0 ${autoSaveStatusClass}`}>
                {autoSaveStatusText}
              </span>
            ) : null}
          </h1>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 text-sm">
          <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border border-slate-200">
            <input
              className="bg-white border border-slate-200 rounded text-sm px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500/30 outline-none transition-all w-48 font-medium placeholder:text-slate-400 text-slate-700"
              placeholder="输入流程名称..."
              value={state.flow.name}
              onChange={event => actions.setFlowName(event.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="!bg-none !bg-slate-50 !shadow-none !text-slate-600 hover:!bg-slate-100 hover:!text-slate-800 !border-slate-200 inline-flex items-center gap-1.5 border px-3 py-1.5 rounded-lg font-medium transition-colors"
              onClick={() => setShowSettingsDrawer(true)}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              全局配置
            </button>

            <button
              type="button"
              className="!bg-none !bg-slate-50 !shadow-none !text-indigo-600 hover:!bg-indigo-50 hover:!text-indigo-700 !border-indigo-100 inline-flex items-center gap-1.5 border px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
              disabled={state.isValidating}
              onClick={() => void actions.validateFlow()}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {state.isValidating ? "校验中..." : "校验"}
            </button>

            <button
              type="button"
              className="!bg-none !bg-orange-500 !bg-gradient-to-br !from-orange-500 !to-amber-500 hover:!from-orange-400 hover:!to-amber-400 !text-white !border-transparent inline-flex items-center gap-1.5 shadow-md shadow-orange-500/20 px-4 py-1.5 rounded-lg font-bold transition-all hover:-translate-y-0.5"
              onClick={runNow}
              disabled={state.isRunning}
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {state.isRunning ? "运行中..." : "立即运行"}
            </button>
          </div>
        </div>
      </section>

      {(state.panelError || validationErrors.length > 0) ? (
        <section className="shrink-0 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-900">
          {state.panelError ? (
            <div className="font-semibold break-all">错误: {state.panelError}</div>
          ) : null}
          {validationErrors.length > 0 ? (
            <div className="mt-2">
              <div className="font-semibold">
                校验失败 ({validationErrors.length})
              </div>
              <ul className="mt-1 space-y-1 list-disc pl-5">
                {validationErrors.slice(0, 8).map((item, index) => (
                  <li key={`${index}-${item}`} className="break-all">{item}</li>
                ))}
              </ul>
              {validationErrors.length > 8 ? (
                <div className="mt-1 text-rose-700">
                  其余 {validationErrors.length - 8} 条请继续修复后重新校验查看。
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0 relative">
        <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden relative z-0">
          <ReactFlowCanvas
            flow={state.flow}
            selectedNodeId={state.selectedNodeId}
            selectedEdgeId={state.selectedEdgeId}
            errorNodeIds={errorNodeIds}
            onSelectNode={handleSelectNode}
            onSelectEdge={handleSelectEdge}
            onAddNode={actions.addNode}
            onAddNodeFromSource={actions.addNodeFromSource}
            onInsertNodeOnEdge={actions.insertNodeOnEdge}
            onRemoveNode={actions.removeNode}
            onAddEdge={actions.addEdge}
            onUpdateNodePosition={actions.updateNodePosition}
          />
          {showTaskCenter ? (
            <TaskCenterPanel
              tasks={state.tasks}
              runStats={state.runStats}
              alerts={state.alerts}
              isLoading={state.isTaskLoading}
              total={state.taskTotal}
              page={state.taskPage}
              pageSize={state.taskPageSize}
              taskName={state.taskName}
              taskIntervalSeconds={state.taskIntervalSeconds}
              onSetPage={actions.setTaskPage}
              onSetPageSize={actions.setTaskPageSize}
              onSetTaskName={actions.setTaskName}
              onSetTaskIntervalSeconds={actions.setTaskIntervalSeconds}
              onCreateTask={actions.createCurrentFlowTask}
              onRefresh={actions.refreshTaskCenter}
              onTriggerTask={actions.triggerTask}
              onPauseTask={actions.pauseTask}
              onResumeTask={actions.resumeTask}
              onDisableTask={actions.disableTask}
              onRetryLastFailedTask={actions.retryLastFailedTask}
            />
          ) : null}
        </div>

        {showSettingsDrawer ? (
          <>
            <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[1px] z-20" onClick={() => setShowSettingsDrawer(false)} />
            <div className="absolute top-0 right-0 h-full w-full max-w-[380px] z-30 p-3 pointer-events-none animate-in slide-in-from-right-full duration-300">
              <aside className="h-full pointer-events-auto bg-white/95 backdrop-blur shadow-2xl rounded-xl border border-slate-200 flex flex-col overflow-hidden flex-1">
                <header className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/50">
                  <h3 className="m-0 text-sm font-bold text-slate-800 flex items-center gap-2">
                    <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    全局配置与高级功能
                  </h3>
                  <button
                    type="button"
                    className="text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 p-1.5 rounded-lg transition-colors"
                    onClick={() => setShowSettingsDrawer(false)}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </header>
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                  <EdgePanel selectedEdge={selectedEdge} onUpdateEdge={actions.updateEdge} onRemoveEdge={actions.removeEdge} />
                  <VariablesPanel flow={state.flow} onSetVariable={actions.updateVariable} onRemoveVariable={actions.removeVariable} />
                  <div className="flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
                    <RecorderImportPanel
                      payloadText={state.recorderPayloadText}
                      strategy={state.recorderImportStrategy}
                      preview={state.recorderPreview}
                      panelError={state.panelError}
                      extensionBridgeEnabled={extensionBridgeEnabled}
                      extensionBridgeHint={extensionBridgeHint}
                      onSetPayloadText={actions.setRecorderPayloadText}
                      onSetStrategy={actions.setRecorderImportStrategy}
                      onPullFromExtension={actions.requestRecorderPayloadFromExtension}
                      onLoadFromText={actions.loadRecorderPayloadFromText}
                      onLoadFromFile={actions.loadRecorderPayloadFromFile}
                      onApplyImport={actions.applyRecorderImport}
                      onClear={actions.clearRecorderImport}
                    />
                    <VersionPanel
                      versions={state.versions}
                      onSaveDraft={actions.saveDraft}
                      onPublish={actions.publishVersion}
                      onRollback={actions.rollbackToVersion}
                    />
                  </div>
                </div>
              </aside>
            </div>
          </>
        ) : null}

        {selectedNode && showNodeDrawer ? (
          <>
            <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[1px] z-20" onClick={closeNodeDrawer} />
            <div className="absolute top-0 right-0 h-full w-full max-w-[440px] z-30 p-3 pointer-events-none">
              <div className="h-full pointer-events-auto">
                <NodePanel
                  key={selectedNode.id}
                  flow={state.flow}
                  selectedNode={selectedNode}
                  onUpdateNode={actions.updateNode}
                  onUpdateNodeConfig={actions.updateNodeConfig}
                  onReplaceNodeConfig={actions.replaceNodeConfig}
                  onRemoveNode={actions.removeNode}
                  onStartElementPicker={actions.startElementPicker}
                  desktopRuntime={isDesktop}
                  elementPickerHint={
                    isDesktop
                      ? "桌面拾取会自动复用浏览器扩展与已打开页面。若节点已配置 pageUrl，将直接启动拾取。"
                      : undefined
                  }
                  onClose={closeNodeDrawer}
                />
              </div>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}


