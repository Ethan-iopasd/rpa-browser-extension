import { useCallback, useEffect, useState } from "react";

import { exportRunEventsRequest, listRunsRequest } from "../../core/api/runs";
import type { RunRecord } from "../../core/api/runs";

type RunsPageProps = {
  onOpenRun: (runId: string) => void;
};

const PAGE_SIZE_OPTIONS = [20, 50, 100];

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

export function RunsPage(props: RunsPageProps) {
  const { onOpenRun } = props;
  const [loading, setLoading] = useState(false);
  const [panelError, setPanelError] = useState("");

  const [statusInput, setStatusInput] = useState("");
  const [taskIdInput, setTaskIdInput] = useState("");
  const [flowIdInput, setFlowIdInput] = useState("");

  const [status, setStatus] = useState("");
  const [taskId, setTaskId] = useState("");
  const [flowId, setFlowId] = useState("");

  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;

  const refresh = useCallback(async () => {
    setLoading(true);
    setPanelError("");
    try {
      const response = await listRunsRequest({
        status: status || undefined,
        taskId: taskId || undefined,
        flowId: flowId || undefined,
        limit: pageSize,
        offset
      });
      if (!response.ok) {
        setPanelError(`${response.error.code}: ${response.error.message}`);
        return;
      }
      setRuns(response.data.runs);
      setTotal(response.data.total);
    } finally {
      setLoading(false);
    }
  }, [flowId, offset, pageSize, status, taskId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  async function exportLogs(runId: string, format: "jsonl" | "csv") {
    const response = await exportRunEventsRequest(runId, format);
    if (!response.ok) {
      setPanelError(`${response.error.code}: ${response.error.message}`);
      return;
    }
    const blob = new Blob([response.data.content], {
      type: format === "jsonl" ? "application/json" : "text/csv"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = response.data.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function applyFilters() {
    setStatus(statusInput);
    setTaskId(taskIdInput.trim());
    setFlowId(flowIdInput.trim());
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/60 backdrop-blur p-5 rounded-2xl border border-slate-200/60 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 m-0">日志列表</h2>
          <p className="text-sm text-slate-500 m-0 mt-1">查看运行日志、筛选记录并导出明细</p>
        </div>
        <button
          type="button"
          className="text-slate-600 hover:text-orange-600 bg-white hover:bg-orange-50 px-4 py-2 border border-slate-200 rounded-lg text-sm font-bold transition-all shadow-sm"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>

      <div className="bg-white/80 backdrop-blur shadow-sm shadow-slate-200/50 border border-slate-200 rounded-2xl p-5 flex flex-col gap-4">
        <h3 className="m-0 text-sm font-bold text-slate-800">筛选条件</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 min-w-[160px]">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">状态</span>
            <select
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
              value={statusInput}
              onChange={event => setStatusInput(event.target.value)}
            >
              <option value="">全部</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
              <option value="running">运行中</option>
              <option value="pending">排队中</option>
              <option value="canceled">已取消</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5 min-w-[220px] flex-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">任务 ID</span>
            <input
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
              value={taskIdInput}
              onChange={event => setTaskIdInput(event.target.value)}
              placeholder="例如 task_xxx"
            />
          </label>

          <label className="flex flex-col gap-1.5 min-w-[220px] flex-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">流程 ID</span>
            <input
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
              value={flowIdInput}
              onChange={event => setFlowIdInput(event.target.value)}
              placeholder="例如 flow_xxx"
            />
          </label>

          <button
            type="button"
            className="bg-slate-800 hover:bg-slate-900 text-white px-5 py-2 rounded-lg text-sm font-bold"
            onClick={applyFilters}
          >
            应用筛选
          </button>
        </div>
      </div>

      {panelError ? (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-600 font-medium text-sm">{panelError}</div>
      ) : null}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden min-h-[400px]">
        {runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[260px] text-center p-8 bg-slate-50/50">
            <h3 className="text-base font-bold text-slate-700 m-0">没有匹配到日志记录</h3>
            <p className="text-sm text-slate-500 m-0 mt-2">可调整筛选条件后重试。</p>
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-200/80">
                  <th className="font-bold py-3.5 px-5 text-xs uppercase tracking-wider">运行 ID</th>
                  <th className="font-bold py-3.5 px-5 text-xs uppercase tracking-wider">关联资源</th>
                  <th className="font-bold py-3.5 px-5 text-xs uppercase tracking-wider">状态</th>
                  <th className="font-bold py-3.5 px-5 text-xs uppercase tracking-wider">开始时间</th>
                  <th className="font-bold py-3.5 px-5 text-xs uppercase tracking-wider text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map(item => (
                  <tr key={item.runId} className="hover:bg-slate-50 transition-colors group">
                    <td className="py-4 px-5">
                      <div className="font-mono text-xs font-bold text-slate-700 select-all">{item.runId}</div>
                    </td>
                    <td className="py-4 px-5">
                      <div className="flex flex-col gap-1.5 font-mono text-[10px]">
                        <div className="text-slate-500">FLOW: {item.flowId}</div>
                        {item.taskId ? <div className="text-slate-500">TASK: {item.taskId}</div> : null}
                      </div>
                    </td>
                    <td className="py-4 px-5">{formatRunStatus(item.status)}</td>
                    <td className="py-4 px-5 text-xs font-mono text-slate-600">
                      {new Date(item.startedAt).toLocaleString("zh-CN", { hour12: false })}
                    </td>
                    <td className="py-4 px-5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          className="text-xs font-bold text-white bg-indigo-500 hover:bg-indigo-600 px-3 py-1.5 rounded-lg"
                          onClick={() => onOpenRun(item.runId)}
                        >
                          查看详情
                        </button>
                        <button
                          type="button"
                          className="text-xs font-bold text-slate-600 hover:text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg"
                          onClick={() => void exportLogs(item.runId, "jsonl")}
                        >
                          导出 JSONL
                        </button>
                        <button
                          type="button"
                          className="text-xs font-bold text-slate-600 hover:text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg"
                          onClick={() => void exportLogs(item.runId, "csv")}
                        >
                          导出 CSV
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
      </div>
    </div>
  );
}
