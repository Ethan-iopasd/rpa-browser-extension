import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FlowModel } from "@rpa/flow-schema/generated/types";

import { useDesignerState } from "../src/features/designer/hooks/useDesignerState";

function createFlow(): FlowModel {
  return {
    schemaVersion: "1.0.0",
    id: "flow_picker_regression",
    name: "picker regression",
    variables: {
      _browserMode: "real",
      _browserHeadless: false
    },
    nodes: [
      { id: "n_start", type: "start", config: {} },
      { id: "n_click", type: "click", config: { selector: "#old", pageUrl: "https://example.com" } },
      { id: "n_end", type: "end", config: {} }
    ],
    edges: [
      { id: "e1", source: "n_start", target: "n_click" },
      { id: "e2", source: "n_click", target: "n_end" }
    ]
  };
}

function getNodeSelector(flow: FlowModel, nodeId: string): string {
  const node = flow.nodes.find(item => item.id === nodeId);
  return typeof node?.config?.selector === "string" ? node.config.selector : "";
}

describe("useDesignerState picker result bridge", () => {
  it("applies RECORDER_PICK_RESULT to the active picker target node", async () => {
    const initialFlow = createFlow();
    const { result } = renderHook(() =>
      useDesignerState({
        initialFlow,
        enableTaskCenter: false
      })
    );

    act(() => {
      result.current.actions.startElementPicker("n_click", "https://example.com", "extension_bridge");
    });

    act(() => {
      window.postMessage(
        {
          source: "rpa-flow-recorder",
          type: "RECORDER_PICK_RESULT",
          payload: {
            selector: "#submit",
            selectorType: "css",
            selectorCandidates: [{ type: "css", value: "#submit", score: 0.95, primary: true }],
            pageUrl: "https://example.com"
          },
          pickerMeta: {
            selectorType: "css"
          }
        },
        "*"
      );
    });

    await waitFor(() => {
      expect(getNodeSelector(result.current.state.flow, "n_click")).toBe("#submit");
    });
    expect(result.current.state.panelError).toBe("");
    expect(result.current.state.panelMessage).toContain("页面拾取成功");
  });

  it("applies RECORDER_PICK_RESULT by targetNodeId even when picker ref is missing", async () => {
    const initialFlow = createFlow();
    const { result } = renderHook(() =>
      useDesignerState({
        initialFlow,
        enableTaskCenter: false
      })
    );

    act(() => {
      window.postMessage(
        {
          source: "rpa-flow-recorder",
          type: "RECORDER_PICK_RESULT",
          targetNodeId: "n_click",
          payload: {
            nodeId: "n_click",
            selector: "#submit-by-node-id",
            selectorType: "css",
            selectorCandidates: [{ type: "css", value: "#submit-by-node-id", score: 0.95, primary: true }],
            pageUrl: "https://example.com"
          },
          pickerMeta: {
            targetNodeId: "n_click",
            selectorType: "css"
          }
        },
        "*"
      );
    });

    await waitFor(() => {
      expect(getNodeSelector(result.current.state.flow, "n_click")).toBe("#submit-by-node-id");
    });
    expect(result.current.state.panelError).toBe("");
  });

  it("reports an error when receiving RECORDER_PICK_RESULT without an active target node", async () => {
    const initialFlow = createFlow();
    const { result } = renderHook(() =>
      useDesignerState({
        initialFlow,
        enableTaskCenter: false
      })
    );

    act(() => {
      window.postMessage(
        {
          source: "rpa-flow-recorder",
          type: "RECORDER_PICK_RESULT",
          payload: {
            selector: "#submit",
            selectorType: "css",
            selectorCandidates: [{ type: "css", value: "#submit", score: 0.95, primary: true }]
          }
        },
        "*"
      );
    });

    await waitFor(() => {
      expect(result.current.state.panelError).toContain("未找到待应用节点");
    });
  });
});
