import { useCallback, useMemo, useState } from "react";

import type { FlowModel } from "@rpa/flow-schema/generated/types";

import { DesignerPage } from "../designer/DesignerPage";
import { loadFlow, saveFlow } from "../../shared/storage/flowStore";
import { sampleFlow } from "../../shared/data/sampleFlow";

type FlowEditorPageProps = {
  flowId: string;
};

export function FlowEditorPage(props: FlowEditorPageProps) {
  const { flowId } = props;
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [autoSaveStatusText, setAutoSaveStatusText] = useState("自动保存已开启");

  const initialFlow = useMemo<FlowModel>(() => {
    const record = loadFlow(flowId);
    if (record) {
      return record.flow;
    }
    const fallback: FlowModel = {
      ...sampleFlow,
      id: flowId,
      name: `流程 ${flowId}`
    };
    saveFlow(fallback, "draft");
    return fallback;
  }, [flowId]);

  const handleFlowChange = useCallback((flow: FlowModel) => {
    setAutoSaveState("saving");
    setAutoSaveStatusText("自动保存中...");
    try {
      saveFlow(flow, "draft");
      const time = new Date().toLocaleTimeString("zh-CN", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
      setAutoSaveState("saved");
      setAutoSaveStatusText(`已自动保存 ${time}`);
    } catch {
      setAutoSaveState("error");
      setAutoSaveStatusText("自动保存失败");
    }
  }, []);

  return (
    <DesignerPage
      initialFlow={initialFlow}
      onFlowChange={handleFlowChange}
      showTaskCenter={false}
      autoSaveState={autoSaveState}
      autoSaveStatusText={autoSaveStatusText}
    />
  );
}
