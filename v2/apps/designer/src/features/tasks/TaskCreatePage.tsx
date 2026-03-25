import { useEffect, useMemo, useState } from "react";

import type { CreateTaskPayload } from "../../core/api/tasks";
import { createTaskRequest, previewScheduleRequest } from "../../core/api/tasks";
import { loadFlow, listFlows } from "../../shared/storage/flowStore";

type TaskCreatePageProps = {
  onCancel: () => void;
  onCreated: (taskId: string) => void;
};

type ScheduleEditorMode = "interval" | "once" | "daily" | "weekly" | "monthly" | "cron";
type WeekdayName = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type ScheduleTemplateId =
  | "interval-5m"
  | "interval-30m"
  | "once-10m"
  | "daily-9"
  | "workdays-9"
  | "workdays-18"
  | "hourly-at-0"
  | "monthly-1"
  | "monthly-lastday-18";

const WEEKDAY_OPTIONS: Array<{ key: WeekdayName; label: string }> = [
  { key: "mon", label: "周一" },
  { key: "tue", label: "周二" },
  { key: "wed", label: "周三" },
  { key: "thu", label: "周四" },
  { key: "fri", label: "周五" },
  { key: "sat", label: "周六" },
  { key: "sun", label: "周日" }
];

const SCHEDULE_TEMPLATES: Array<{ id: ScheduleTemplateId; label: string; description: string }> = [
  { id: "interval-5m", label: "每 5 分钟", description: "固定间隔轮询任务" },
  { id: "interval-30m", label: "每 30 分钟", description: "中频同步、批处理任务" },
  { id: "once-10m", label: "10 分钟后一次", description: "仅执行一次，适合临时任务" },
  { id: "daily-9", label: "每天 09:00", description: "每天固定时间执行" },
  { id: "workdays-9", label: "工作日 09:00", description: "周一到周五自动执行" },
  { id: "workdays-18", label: "工作日 18:00", description: "工作日下班后执行" },
  { id: "hourly-at-0", label: "每小时整点", description: "使用 Cron 在整点触发" },
  { id: "monthly-1", label: "每月 1 号", description: "每月 1 号 09:00 执行" },
  { id: "monthly-lastday-18", label: "每月最后一天", description: "每月最后一天 18:00 执行" }
];

function localDateTimeAfterMinutes(minutes: number): string {
  const date = new Date(Date.now() + minutes * 60_000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toIso(localDateTime: string): string | null {
  const parsed = new Date(localDateTime);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function TaskCreatePage(props: TaskCreatePageProps) {
  const { onCancel, onCreated } = props;
  const [panelError, setPanelError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewRuns, setPreviewRuns] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const flowOptions = useMemo(() => listFlows(), []);
  const [selectedFlowId, setSelectedFlowId] = useState(() => flowOptions[0]?.flowId ?? "");
  const [newTaskName, setNewTaskName] = useState("我的定时任务");
  const [editorMode, setEditorMode] = useState<ScheduleEditorMode>("interval");
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [onceAt, setOnceAt] = useState(localDateTimeAfterMinutes(10));
  const [timeOfDay, setTimeOfDay] = useState("09:00");
  const [weekdays, setWeekdays] = useState<WeekdayName[]>(["mon", "tue", "wed", "thu", "fri"]);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [cronExpr, setCronExpr] = useState("0 9 * * 1-5");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [selectedTemplateId, setSelectedTemplateId] = useState<ScheduleTemplateId | null>(null);

  function applyTemplate(templateId: ScheduleTemplateId) {
    setSelectedTemplateId(templateId);
    setPanelError("");
    if (templateId === "interval-5m") {
      setEditorMode("interval");
      setIntervalMinutes(5);
      return;
    }
    if (templateId === "interval-30m") {
      setEditorMode("interval");
      setIntervalMinutes(30);
      return;
    }
    if (templateId === "once-10m") {
      setEditorMode("once");
      setOnceAt(localDateTimeAfterMinutes(10));
      return;
    }
    if (templateId === "daily-9") {
      setEditorMode("daily");
      setTimeOfDay("09:00");
      return;
    }
    if (templateId === "workdays-9") {
      setEditorMode("weekly");
      setWeekdays(["mon", "tue", "wed", "thu", "fri"]);
      setTimeOfDay("09:00");
      return;
    }
    if (templateId === "workdays-18") {
      setEditorMode("weekly");
      setWeekdays(["mon", "tue", "wed", "thu", "fri"]);
      setTimeOfDay("18:00");
      return;
    }
    if (templateId === "hourly-at-0") {
      setEditorMode("cron");
      setCronExpr("0 * * * *");
      return;
    }
    if (templateId === "monthly-lastday-18") {
      setEditorMode("monthly");
      setDayOfMonth(31);
      setTimeOfDay("18:00");
      return;
    }
    setEditorMode("monthly");
    setDayOfMonth(1);
    setTimeOfDay("09:00");
  }

  function buildSchedulePayload(): NonNullable<CreateTaskPayload["schedule"]> | null {
    if (editorMode === "interval") {
      return {
        mode: "interval",
        intervalSeconds: Math.max(60, Math.floor(intervalMinutes * 60))
      };
    }
    if (editorMode === "once") {
      const runAt = toIso(onceAt);
      if (!runAt) {
        return null;
      }
      return {
        mode: "once",
        runAt
      };
    }
    if (editorMode === "daily") {
      return {
        mode: "daily",
        timezone,
        timeOfDay
      };
    }
    if (editorMode === "weekly") {
      return {
        mode: "weekly",
        timezone,
        timeOfDay,
        weekdays
      };
    }
    if (editorMode === "monthly") {
      return {
        mode: "monthly",
        timezone,
        timeOfDay,
        dayOfMonth: Math.max(1, Math.min(31, dayOfMonth))
      };
    }
    return {
      mode: "cron",
      timezone,
      cronExpr: cronExpr.trim()
    };
  }

  async function loadPreview() {
    const schedule = buildSchedulePayload();
    if (!schedule) {
      setPreviewError("调度配置无效。");
      setPreviewRuns([]);
      return;
    }

    setPreviewError("");
    const response = await previewScheduleRequest({
      schedule,
      count: 5
    });
    if (!response.ok) {
      setPreviewError(`${response.error.code}: ${response.error.message}`);
      setPreviewRuns([]);
      return;
    }
    setPreviewRuns(response.data.nextRuns);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPreview();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [editorMode, intervalMinutes, onceAt, timeOfDay, weekdays, dayOfMonth, cronExpr, timezone]);

  function toggleWeekday(day: WeekdayName) {
    setSelectedTemplateId(null);
    setWeekdays(previous => {
      if (previous.includes(day)) {
        return previous.filter(item => item !== day);
      }
      return [...previous, day];
    });
  }

  async function createTask() {
    const flowRecord = selectedFlowId ? loadFlow(selectedFlowId) : null;
    if (!flowRecord) {
      setPanelError("请选择有效流程。");
      return;
    }
    const schedule = buildSchedulePayload();
    if (!schedule) {
      setPanelError("调度配置无效。");
      return;
    }

    setCreating(true);
    setPanelError("");
    try {
      const response = await createTaskRequest({
        name: newTaskName.trim() || "未命名任务",
        type: "scheduled",
        flow: flowRecord.flow,
        schedule,
        runOptions: {
          maxSteps: 1000,
          defaultTimeoutMs: 5000,
          defaultMaxRetries: 0
        }
      });
      if (!response.ok) {
        setPanelError(`${response.error.code}: ${response.error.message}`);
        return;
      }
      onCreated(response.data.taskId);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-3xl mx-auto p-4 sm:p-6 lg:p-8">
      <section className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="m-0 text-base font-semibold text-slate-800">新建定时任务</h3>
          <button
            type="button"
            className="px-3 py-1.5 border border-slate-300 rounded-md text-sm hover:bg-slate-50"
            onClick={onCancel}
          >
            返回列表
          </button>
        </div>

        {panelError ? (
          <div className="px-3 py-2 text-sm text-rose-600 border border-rose-200 bg-rose-50 rounded-md">
            {panelError}
          </div>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">任务名称</span>
          <input
            className="px-3 py-2 border border-slate-300 rounded-md"
            value={newTaskName}
            onChange={event => setNewTaskName(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">绑定流程</span>
          <select
            className="px-3 py-2 border border-slate-300 rounded-md"
            value={selectedFlowId}
            onChange={event => setSelectedFlowId(event.target.value)}
          >
            <option value="" disabled>
              请选择流程
            </option>
            {flowOptions.map(item => (
              <option key={item.flowId} value={item.flowId}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-2 text-sm">
          <span className="text-slate-600">快捷模板</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SCHEDULE_TEMPLATES.map(template => {
              const active = selectedTemplateId === template.id;
              return (
                <button
                  key={template.id}
                  type="button"
                  className={`text-left rounded-md border px-3 py-2 transition-colors ${
                    active
                      ? "border-sky-400 bg-sky-50 text-sky-800"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  onClick={() => applyTemplate(template.id)}
                >
                  <div className="text-sm font-semibold">{template.label}</div>
                  <div className="text-xs opacity-80 mt-0.5">{template.description}</div>
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">调度类型</span>
          <select
            className="px-3 py-2 border border-slate-300 rounded-md"
            value={editorMode}
            onChange={event => {
              setSelectedTemplateId(null);
              setEditorMode(event.target.value as ScheduleEditorMode);
            }}
          >
            <option value="interval">每 N 分钟</option>
            <option value="once">仅执行一次</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
            <option value="monthly">每月</option>
            <option value="cron">高级 Cron</option>
          </select>
        </label>

        {editorMode === "interval" ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">每隔（分钟）</span>
            <input
              className="px-3 py-2 border border-slate-300 rounded-md"
              type="number"
              min={1}
              value={intervalMinutes}
              onChange={event => {
                setSelectedTemplateId(null);
                setIntervalMinutes(Number(event.target.value));
              }}
            />
          </label>
        ) : null}

        {editorMode === "once" ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">执行时间</span>
            <input
              className="px-3 py-2 border border-slate-300 rounded-md"
              type="datetime-local"
              value={onceAt}
              onChange={event => {
                setSelectedTemplateId(null);
                setOnceAt(event.target.value);
              }}
            />
          </label>
        ) : null}

        {editorMode === "daily" || editorMode === "weekly" || editorMode === "monthly" || editorMode === "cron" ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">时区</span>
            <input
              className="px-3 py-2 border border-slate-300 rounded-md"
              value={timezone}
              onChange={event => {
                setSelectedTemplateId(null);
                setTimezone(event.target.value);
              }}
            />
          </label>
        ) : null}

        {editorMode === "daily" || editorMode === "weekly" || editorMode === "monthly" ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">每日时间</span>
            <input
              className="px-3 py-2 border border-slate-300 rounded-md"
              type="time"
              value={timeOfDay}
              onChange={event => {
                setSelectedTemplateId(null);
                setTimeOfDay(event.target.value);
              }}
            />
          </label>
        ) : null}

        {editorMode === "weekly" ? (
          <div className="flex flex-col gap-2 text-sm">
            <span className="text-slate-600">每周执行日</span>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_OPTIONS.map(item => {
                const active = weekdays.includes(item.key);
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`px-2 py-1 rounded border text-xs ${
                      active ? "bg-sky-50 border-sky-400 text-sky-700" : "bg-white border-slate-300 text-slate-600"
                    }`}
                    onClick={() => toggleWeekday(item.key)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {editorMode === "monthly" ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">每月日期</span>
            <input
              className="px-3 py-2 border border-slate-300 rounded-md"
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={event => {
                setSelectedTemplateId(null);
                setDayOfMonth(Number(event.target.value));
              }}
            />
          </label>
        ) : null}

        {editorMode === "cron" ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Cron 表达式</span>
            <input
              className="px-3 py-2 border border-slate-300 rounded-md font-mono text-xs"
              value={cronExpr}
              onChange={event => {
                setSelectedTemplateId(null);
                setCronExpr(event.target.value);
              }}
              placeholder="0 9 * * 1-5"
            />
          </label>
        ) : null}

        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs">
          <div className="font-semibold text-slate-700">未来执行预览</div>
          {previewError ? <div className="text-rose-600 mt-2">{previewError}</div> : null}
          {!previewError && previewRuns.length === 0 ? <div className="text-slate-500 mt-2">暂无可执行时间。</div> : null}
          {!previewError && previewRuns.length > 0 ? (
            <ul className="mt-2 list-disc list-inside text-slate-700 space-y-1">
              {previewRuns.map(item => (
                <li key={item}>{formatDateTime(item)}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <button
          type="button"
          className="w-full rounded-md bg-slate-800 text-white py-2 hover:bg-slate-900 disabled:opacity-60"
          onClick={() => void createTask()}
          disabled={creating}
        >
          {creating ? "创建中..." : "创建任务"}
        </button>
      </section>
    </div>
  );
}
