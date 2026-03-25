import { useEffect, useMemo, useState } from "react";

import { API_BASE } from "../../shared/config/env";
import {
  exportDesktopDiagnostics,
  getDesktopPreferences,
  getDesktopReleaseInfo,
  getDesktopServiceStatus,
  restartDesktopServices,
  setDesktopAutostartEnabled,
  setDesktopCloseBehavior,
  type DesktopCloseBehavior,
  type DesktopPreferences,
  type DesktopReleaseInfo,
  type DesktopServiceStatus
} from "../../shared/desktop/bridge";

const SETTINGS_KEY = "rpa.flow.ui.settings.v1";

type UiSettings = {
  defaultRunMaxSteps: number;
  defaultTimeoutMs: number;
  defaultRetry: number;
  showAdvancedByDefault: boolean;
};

const DEFAULT_SETTINGS: UiSettings = {
  defaultRunMaxSteps: 1000,
  defaultTimeoutMs: 5000,
  defaultRetry: 0,
  showAdvancedByDefault: false
};

function loadSettings(): UiSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }
  const raw = window.localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    return DEFAULT_SETTINGS;
  }
  try {
    return JSON.parse(raw) as UiSettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function formatEpochMs(value?: number | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function statusBadgeClass(status: string): string {
  if (status === "ready") {
    return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  }
  if (status === "restarting" || status === "starting") {
    return "bg-amber-50 text-amber-700 border border-amber-200";
  }
  if (status === "error" || status === "unhealthy") {
    return "bg-rose-50 text-rose-700 border border-rose-200";
  }
  return "bg-slate-100 text-slate-700 border border-slate-200";
}

export function SettingsPage() {
  const [settings, setSettings] = useState<UiSettings>(() => loadSettings());
  const [message, setMessage] = useState("");

  const [desktopStatus, setDesktopStatus] = useState<DesktopServiceStatus | null>(null);
  const [desktopReleaseInfo, setDesktopReleaseInfo] = useState<DesktopReleaseInfo | null>(null);
  const [desktopPreferences, setDesktopPreferences] = useState<DesktopPreferences | null>(null);
  const [desktopDetected, setDesktopDetected] = useState<boolean | null>(null);
  const [desktopMessage, setDesktopMessage] = useState("");
  const [refreshingDesktop, setRefreshingDesktop] = useState(false);
  const [restartingDesktop, setRestartingDesktop] = useState(false);
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false);
  const [savingDesktopPreferences, setSavingDesktopPreferences] = useState(false);

  async function refreshDesktopStatus() {
    setRefreshingDesktop(true);
    try {
      const [status, preferences] = await Promise.all([getDesktopServiceStatus(), getDesktopPreferences()]);
      if (status) {
        setDesktopStatus(status);
        setDesktopPreferences(preferences);
        setDesktopDetected(true);
      } else {
        setDesktopStatus(null);
        setDesktopPreferences(null);
        setDesktopDetected(false);
      }
    } catch (error) {
      setDesktopDetected(true);
      setDesktopMessage(`获取桌面运行状态失败：${String(error)}`);
    } finally {
      setRefreshingDesktop(false);
    }
  }

  useEffect(() => {
    void refreshDesktopStatus();
    void (async () => {
      const info = await getDesktopReleaseInfo();
      setDesktopReleaseInfo(info);
    })();
    const timer = window.setInterval(() => {
      void refreshDesktopStatus();
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const desktopHint = useMemo(() => {
    if (desktopDetected === null) {
      return "正在检测桌面运行环境...";
    }
    if (!desktopDetected) {
      return "当前为浏览器开发模式，桌面诊断功能不可用。";
    }
    return "已连接桌面运行时，可执行重启、导出诊断和后台行为设置。";
  }, [desktopDetected]);

  function saveSettings() {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    setMessage("设置已保存");
  }

  async function restartRuntime() {
    setDesktopMessage("");
    setRestartingDesktop(true);
    try {
      const status = await restartDesktopServices();
      if (status) {
        setDesktopStatus(status);
        setDesktopMessage("已触发桌面服务重启。");
      } else {
        setDesktopMessage("当前不是桌面运行模式，无法执行重启。");
      }
    } catch (error) {
      setDesktopMessage(`重启失败：${String(error)}`);
    } finally {
      setRestartingDesktop(false);
    }
  }

  async function exportDiagnostics() {
    setDesktopMessage("");
    setExportingDiagnostics(true);
    try {
      const path = await exportDesktopDiagnostics();
      if (path) {
        setDesktopMessage(`诊断包已导出：${path}`);
      } else {
        setDesktopMessage("当前不是桌面运行模式，无法导出诊断包。");
      }
    } catch (error) {
      setDesktopMessage(`导出失败：${String(error)}`);
    } finally {
      setExportingDiagnostics(false);
    }
  }

  async function updateCloseBehavior(behavior: DesktopCloseBehavior) {
    if (!desktopDetected) {
      return;
    }
    setDesktopMessage("");
    setSavingDesktopPreferences(true);
    try {
      const preferences = await setDesktopCloseBehavior(behavior);
      if (preferences) {
        setDesktopPreferences(preferences);
        setDesktopMessage("关闭行为已更新。");
      }
    } catch (error) {
      setDesktopMessage(`保存关闭行为失败：${String(error)}`);
    } finally {
      setSavingDesktopPreferences(false);
    }
  }

  async function updateAutostart(enabled: boolean) {
    if (!desktopDetected) {
      return;
    }
    setDesktopMessage("");
    setSavingDesktopPreferences(true);
    try {
      const preferences = await setDesktopAutostartEnabled(enabled);
      if (preferences) {
        setDesktopPreferences(preferences);
        setDesktopMessage(enabled ? "已开启开机自启动。" : "已关闭开机自启动。");
      }
    } catch (error) {
      setDesktopMessage(`更新开机启动失败：${String(error)}`);
    } finally {
      setSavingDesktopPreferences(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto p-4 sm:p-6 lg:p-8">
      <section className="bg-white/80 backdrop-blur border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800 m-0">本地偏好设置</h2>
            <p className="text-sm text-slate-500 mt-1 m-0">控制默认运行参数和编辑器显示行为。</p>
          </div>
          {message ? (
            <span className="text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
              {message}
            </span>
          ) : null}
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-slate-700">单次运行最大步数</span>
            <input
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-400/20"
              type="number"
              min={1}
              value={settings.defaultRunMaxSteps}
              onChange={event =>
                setSettings(prev => ({ ...prev, defaultRunMaxSteps: Math.max(Number(event.target.value), 1) }))
              }
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-slate-700">节点超时时间（毫秒）</span>
            <input
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-400/20"
              type="number"
              min={1}
              value={settings.defaultTimeoutMs}
              onChange={event =>
                setSettings(prev => ({ ...prev, defaultTimeoutMs: Math.max(Number(event.target.value), 1) }))
              }
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-slate-700">失败重试次数</span>
            <input
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-400/20"
              type="number"
              min={0}
              value={settings.defaultRetry}
              onChange={event => setSettings(prev => ({ ...prev, defaultRetry: Math.max(Number(event.target.value), 0) }))}
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-slate-700">默认显示专业模式</span>
            <select
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-400/20"
              value={settings.showAdvancedByDefault ? "1" : "0"}
              onChange={event => setSettings(prev => ({ ...prev, showAdvancedByDefault: event.target.value === "1" }))}
            >
              <option value="0">关闭</option>
              <option value="1">开启</option>
            </select>
          </label>
        </div>

        <div className="flex items-center justify-end">
          <button
            type="button"
            className="bg-slate-800 hover:bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm font-semibold"
            onClick={saveSettings}
          >
            保存设置
          </button>
        </div>
      </section>

      <section className="bg-white/80 backdrop-blur border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800 m-0">桌面运行诊断</h2>
            <p className="text-sm text-slate-500 mt-1 m-0">{desktopHint}</p>
          </div>
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
            disabled={refreshingDesktop}
            onClick={() => void refreshDesktopStatus()}
          >
            {refreshingDesktop ? "刷新中..." : "刷新状态"}
          </button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="text-slate-500">API 地址</div>
            <div className="font-mono text-slate-700 mt-1">{API_BASE}</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="text-slate-500">API 状态</div>
            <div className="mt-1">
              <span className={`px-2 py-1 rounded-md text-xs font-semibold ${statusBadgeClass(desktopStatus?.apiStatus ?? "idle")}`}>
                {desktopStatus?.apiStatus ?? "unavailable"}
              </span>
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="text-slate-500">自动监控</div>
            <div className="text-slate-700 mt-1">{desktopStatus?.apiSupervisionEnabled ? "已启用" : "未启用"}</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="text-slate-500">Agent 状态</div>
            <div className="mt-1">
              <span
                className={`px-2 py-1 rounded-md text-xs font-semibold ${statusBadgeClass(desktopStatus?.agentStatus ?? "idle")}`}
              >
                {desktopStatus?.agentStatus ?? "unavailable"}
              </span>
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="text-slate-500">重启次数 / 连续失败</div>
            <div className="text-slate-700 mt-1">
              {desktopStatus ? `${desktopStatus.apiRestartCount} / ${desktopStatus.apiConsecutiveFailures}` : "-"}
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="text-slate-500">Agent 恢复次数 / 连续失败</div>
            <div className="text-slate-700 mt-1">
              {desktopStatus ? `${desktopStatus.agentRecoveryCount} / ${desktopStatus.agentConsecutiveFailures}` : "-"}
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 md:col-span-2">
            <div className="text-slate-500">最后健康检查时间</div>
            <div className="text-slate-700 mt-1">{formatEpochMs(desktopStatus?.lastHealthCheckAtEpochMs)}</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 md:col-span-2">
            <div className="text-slate-500">Agent 最后检查时间</div>
            <div className="text-slate-700 mt-1">{formatEpochMs(desktopStatus?.lastAgentHealthCheckAtEpochMs)}</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="text-slate-500">桌面版本</div>
            <div className="text-slate-700 mt-1">{desktopReleaseInfo?.version ?? "-"}</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="text-slate-500">构建档位</div>
            <div className="text-slate-700 mt-1">{desktopReleaseInfo?.buildProfile ?? "-"}</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 md:col-span-2">
            <div className="text-slate-500">诊断目录</div>
            <div className="text-slate-700 mt-1 break-all">{desktopReleaseInfo?.diagnosticsDir ?? "-"}</div>
          </div>
        </div>

        {desktopDetected ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <label className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
              <span className="text-slate-500">关闭窗口时</span>
              <select
                className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-400/20"
                value={desktopPreferences?.closeBehavior ?? "ask"}
                disabled={!desktopPreferences || savingDesktopPreferences}
                onChange={event => void updateCloseBehavior(event.target.value as DesktopCloseBehavior)}
              >
                <option value="ask">每次询问（推荐）</option>
                <option value="minimize_to_tray">直接最小化到系统托盘</option>
                <option value="exit">直接退出程序</option>
              </select>
            </label>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-slate-500">开机自动启动</div>
                <p className="text-xs text-slate-500 m-0 mt-1">
                  {desktopPreferences?.autostartSupported
                    ? "Windows 开机后自动拉起桌面程序。"
                    : "当前平台暂不支持开机自启动。"}
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={desktopPreferences?.autostartEnabled ?? false}
                  disabled={!desktopPreferences?.autostartSupported || savingDesktopPreferences}
                  onChange={event => void updateAutostart(event.target.checked)}
                />
                启用
              </label>
            </div>
          </div>
        ) : null}

        {desktopStatus?.message ? (
          <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            {desktopStatus.message}
          </div>
        ) : null}

        {desktopStatus?.agentMessage ? (
          <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            {desktopStatus.agentMessage}
          </div>
        ) : null}

        {desktopMessage ? (
          <div className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">{desktopMessage}</div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
            onClick={() => void restartRuntime()}
            disabled={!desktopDetected || restartingDesktop}
          >
            {restartingDesktop ? "重启中..." : "重启桌面服务"}
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
            onClick={() => void exportDiagnostics()}
            disabled={!desktopDetected || exportingDiagnostics}
          >
            {exportingDiagnostics ? "导出中..." : "导出诊断包"}
          </button>
        </div>
      </section>
    </div>
  );
}
