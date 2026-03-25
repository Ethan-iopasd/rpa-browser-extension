import { useEffect, useMemo, useState } from "react";

import { ConsoleLayout } from "./ConsoleLayout";
import { buildPath, matchPath, navigate, replace, usePathname } from "./navigation";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { FlowEditorPage } from "../features/flows/FlowEditorPage";
import { FlowsPage } from "../features/flows/FlowsPage";
import { RunDetailPage } from "../features/runs/RunDetailPage";
import { RunsPage } from "../features/runs/RunsPage";
import { SecurityCredentialsPage } from "../features/security/SecurityCredentialsPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { TaskCreatePage } from "../features/tasks/TaskCreatePage";
import { TaskDetailPage } from "../features/tasks/TaskDetailPage";
import { TasksPage } from "../features/tasks/TasksPage";
import { DesktopCloseDialog } from "../shared/desktop/DesktopCloseDialog";
import { acknowledgeDesktopClosePrompt } from "../shared/desktop/bridge";
import { ensureSeedFlow, listFlows } from "../shared/storage/flowStore";
import "./App.css";

type AppRoute =
  | { id: "dashboard" }
  | { id: "flows" }
  | { id: "flow-editor"; flowId: string }
  | { id: "runs" }
  | { id: "run-detail"; runId: string }
  | { id: "tasks" }
  | { id: "task-create" }
  | { id: "task-detail"; taskId: string }
  | { id: "security" }
  | { id: "settings" }
  | { id: "not-found" };

export function App() {
  const pathname = usePathname();
  const [showCloseDialog, setShowCloseDialog] = useState(false);

  useEffect(() => {
    ensureSeedFlow();
  }, []);

  useEffect(() => {
    let disposed = false;
    let attached = false;
    let timerId: number | null = null;
    const unlistenFns: Array<() => void> = [];

    const attachListeners = async () => {
      if (disposed || attached) {
        return;
      }
      try {
        const eventApi = await import("@tauri-apps/api/event");
        const webviewWindowApi = await import("@tauri-apps/api/webviewWindow");
        if (disposed || attached) {
          return;
        }

        const handleCloseRequested = () => {
          // 用自定义 React 弹窗替代被 Tauri webview 屏蔽的 window.confirm
          setShowCloseDialog(true);
          void acknowledgeDesktopClosePrompt();
        };

        unlistenFns.push(await eventApi.listen("desktop-close-requested", handleCloseRequested));
        unlistenFns.push(
          await webviewWindowApi.getCurrentWebviewWindow().listen("desktop-close-requested", handleCloseRequested)
        );
        attached = true;
      } catch {
        // Browser mode or unavailable Tauri event bridge. Keep retrying.
      }
    };

    void attachListeners();
    timerId = window.setInterval(() => {
      void attachListeners();
    }, 1000);

    return () => {
      disposed = true;
      if (timerId !== null) {
        window.clearInterval(timerId);
      }
      for (const unlisten of unlistenFns) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    if (pathname === "/") {
      replace("/dashboard");
      return;
    }

    if (pathname === "/editor") {
      const flows = listFlows();
      const defaultFlowId = flows[0]?.flowId ?? "flow_demo_001";
      replace(`/flows/${defaultFlowId}/editor`);
    }
  }, [pathname]);

  const route = useMemo<AppRoute>(() => {
    if (pathname === "/dashboard") {
      return { id: "dashboard" };
    }
    if (pathname === "/flows") {
      return { id: "flows" };
    }

    const flowEditorMatch = matchPath("/flows/:flowId/editor", pathname);
    if (flowEditorMatch?.flowId) {
      return { id: "flow-editor", flowId: flowEditorMatch.flowId };
    }

    if (pathname === "/runs") {
      return { id: "runs" };
    }

    const runDetailMatch = matchPath("/runs/:runId", pathname);
    if (runDetailMatch?.runId) {
      return { id: "run-detail", runId: runDetailMatch.runId };
    }

    if (pathname === "/tasks") {
      return { id: "tasks" };
    }

    if (pathname === "/tasks/new") {
      return { id: "task-create" };
    }

    const taskDetailMatch = matchPath("/tasks/:taskId", pathname);
    if (taskDetailMatch?.taskId) {
      return { id: "task-detail", taskId: taskDetailMatch.taskId };
    }

    if (pathname === "/security/credentials") {
      return { id: "security" };
    }

    if (pathname === "/settings") {
      return { id: "settings" };
    }

    return { id: "not-found" };
  }, [pathname]);

  // DesktopCloseDialog 必须在所有路由里都挂载（全局 overlay）
  // 否则只有特定页面能响应 desktop-close-requested 事件
  const closeDialog = (
    <DesktopCloseDialog open={showCloseDialog} onClose={() => setShowCloseDialog(false)} />
  );

  if (route.id === "not-found") {
    return (
      <>
        {closeDialog}
        <ConsoleLayout
          pathname={pathname}
          title="页面不存在"
          subtitle="请从左侧导航进入有效功能页。"
          breadcrumbs={[{ label: "404" }]}
        >
          <section className="panel">
            <p className="muted-text">当前地址：{pathname}</p>
            <button type="button" onClick={() => navigate("/dashboard")}>
              返回总览
            </button>
          </section>
        </ConsoleLayout>
      </>
    );
  }

  if (route.id === "dashboard") {
    return (
      <>
        {closeDialog}
        <ConsoleLayout
          pathname={pathname}
          title="控制台总览"
          subtitle="聚合运行、任务和告警，快速发现异常。"
          breadcrumbs={[{ label: "总览" }]}
        >
          <DashboardPage
            onOpenRun={runId => navigate(buildPath("/runs/:runId", { runId }))}
            onOpenTask={taskId => navigate(buildPath("/tasks/:taskId", { taskId }))}
          />
        </ConsoleLayout>
      </>
    );
  }

  if (route.id === "flows") {
    return (
      <>
        {closeDialog}
        <ConsoleLayout
          pathname={pathname}
          title="流程管理"
          subtitle="管理流程草稿与发布状态，并进入画布编辑。"
          breadcrumbs={[{ label: "流程" }]}
        >
          <FlowsPage onOpenEditor={flowId => navigate(buildPath("/flows/:flowId/editor", { flowId }))} />
        </ConsoleLayout>
      </>
    );
  }

  if (route.id === "flow-editor") {
    return (
      <>
        {closeDialog}
        <ConsoleLayout
          pathname={pathname}
          title="流程编辑器"
          subtitle="可视化画布编排，支持简洁模式与专业模式。"
          breadcrumbs={[
            { label: "流程", to: "/flows" },
            { label: route.flowId }
          ]}
        >
          <FlowEditorPage flowId={route.flowId} />
        </ConsoleLayout>
      </>
    );
  }

  if (route.id === "runs") {
    return (
      <>
        {closeDialog}
        <ConsoleLayout
          pathname={pathname}
          title="日志中心"
          subtitle="按状态、任务、流程筛选日志记录，并支持日志导出。"
          breadcrumbs={[{ label: "日志" }]}
        >
          <RunsPage onOpenRun={runId => navigate(buildPath("/runs/:runId", { runId }))} />
        </ConsoleLayout>
      </>
    );
  }

  if (route.id === "run-detail") {
    return (
      <>
        {closeDialog}
        <ConsoleLayout
          pathname={pathname}
          title="日志详情"
          subtitle="查看事件链路、错误聚类，并可回跳流程编辑器。"
          breadcrumbs={[
            { label: "日志", to: "/runs" },
            { label: route.runId }
          ]}
        >
          <RunDetailPage
            runId={route.runId}
            onOpenFlowEditor={flowId => navigate(buildPath("/flows/:flowId/editor", { flowId }))}
          />
        </ConsoleLayout>
      </>
    );
  }

  if (route.id === "tasks") {
    return (
      <>
        {closeDialog}
        <ConsoleLayout
          pathname={pathname}
          title="任务中心"
          subtitle="管理手动、定时、批量任务，执行触发与状态控制。"
          breadcrumbs={[{ label: "任务" }]}
        >
          <TasksPage
            onOpenTask={taskId => navigate(buildPath("/tasks/:taskId", { taskId }))}
            onCreateTask={() => navigate("/tasks/new")}
          />
        </ConsoleLayout>
      </>
    );
  }

  if (route.id === "task-create") {
    return (
      <>
        {closeDialog}
        <ConsoleLayout
          pathname={pathname}
          title="新建任务"
          subtitle="创建新的定时任务并配置调度方式。"
          breadcrumbs={[
            { label: "任务", to: "/tasks" },
            { label: "新建任务" }
          ]}
        >
          <TaskCreatePage
            onCancel={() => navigate("/tasks")}
            onCreated={taskId => navigate(buildPath("/tasks/:taskId", { taskId }))}
          />
        </ConsoleLayout>
      </>
    );
  }

  if (route.id === "task-detail") {
    return (
      <>
        {closeDialog}
        <ConsoleLayout
          pathname={pathname}
          title="任务详情"
          subtitle="查看任务调度配置、历史运行和失败重跑。"
          breadcrumbs={[
            { label: "任务", to: "/tasks" },
            { label: route.taskId }
          ]}
        >
          <TaskDetailPage taskId={route.taskId} onOpenRun={runId => navigate(buildPath("/runs/:runId", { runId }))} />
        </ConsoleLayout>
      </>
    );
  }

  if (route.id === "security") {
    return (
      <>
        {closeDialog}
        <ConsoleLayout
          pathname={pathname}
          title="安全与凭据"
          subtitle="集中管理凭据与审计日志。"
          breadcrumbs={[{ label: "安全" }]}
        >
          <SecurityCredentialsPage />
        </ConsoleLayout>
      </>
    );
  }

  // settings fallback
  return (
    <>
      {closeDialog}
      <ConsoleLayout
        pathname={pathname}
        title="设置"
        subtitle="维护本地默认参数与界面行为。"
        breadcrumbs={[{ label: "设置" }]}
      >
        <SettingsPage />
      </ConsoleLayout>
    </>
  );
}
