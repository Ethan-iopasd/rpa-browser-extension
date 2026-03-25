import { describe, expect, it } from "vitest";

import type { FlowModel } from "@rpa/flow-schema/generated/types";

import { applyReactFlowPositionsToFlow, flowToReactFlowEdges, flowToReactFlowNodes } from "../src/features/designer/utils/flowAdapter";
import { readNodePosition } from "../src/features/designer/utils/flow";

function createFlow(): FlowModel {
  return {
    schemaVersion: "1.0.0",
    id: "flow_test",
    name: "test",
    nodes: [
      { id: "n_start", type: "start", label: "Start", config: {} },
      { id: "n_wait", type: "wait", label: "Wait", config: { __ui: { x: 320, y: 140 } } },
      { id: "n_end", type: "end", label: "End", config: {} }
    ],
    edges: [
      { id: "e1", source: "n_start", target: "n_wait" },
      { id: "e2", source: "n_wait", target: "n_end" }
    ]
  };
}

describe("flowAdapter", () => {
  it("maps flow model to react-flow nodes and edges", () => {
    const flow = createFlow();
    const nodes = flowToReactFlowNodes(flow, "n_wait", ["n_end"]);
    const edges = flowToReactFlowEdges(flow, "e2");

    expect(nodes).toHaveLength(3);
    expect(nodes[1]?.id).toBe("n_wait");
    expect(nodes[1]?.selected).toBe(true);
    expect(nodes[2]?.data.hasError).toBe(true);
    expect(nodes[1]?.position).toEqual({ x: 320, y: 140 });

    expect(edges).toHaveLength(2);
    expect(edges[1]?.id).toBe("e2");
    expect(edges[1]?.selected).toBe(true);
  });

  it("maps branch conditions to source handles for if/loop/switchCase", () => {
    const flow: FlowModel = {
      schemaVersion: "1.0.0",
      id: "flow_branch",
      name: "branch",
      nodes: [
        { id: "n_start", type: "start", label: "Start", config: {} },
        { id: "n_if", type: "if", label: "If", config: { expression: "{{flag}}" } },
        { id: "n_loop", type: "loop", label: "Loop", config: { times: 2 } },
        { id: "n_switch", type: "switchCase", label: "Switch", config: { expression: "{{status}}", cases: ["ok", "default"] } },
        { id: "n_end", type: "end", label: "End", config: {} }
      ],
      edges: [
        { id: "e_if_t", source: "n_if", target: "n_end", condition: "true" },
        { id: "e_loop_b", source: "n_loop", target: "n_end", condition: "body" },
        { id: "e_sw_ok", source: "n_switch", target: "n_end", condition: "ok" },
      ]
    };

    const edges = flowToReactFlowEdges(flow, null);
    const ifEdge = edges.find(edge => edge.id === "e_if_t");
    const loopEdge = edges.find(edge => edge.id === "e_loop_b");
    const switchEdge = edges.find(edge => edge.id === "e_sw_ok");

    expect(ifEdge?.sourceHandle).toBe("if-true");
    expect(loopEdge?.sourceHandle).toBe("loop-body");
    expect(switchEdge?.sourceHandle).toBe("switch-case-0");
  });

  it("writes react-flow positions back to flow model config", () => {
    const flow = createFlow();
    const next = applyReactFlowPositionsToFlow(flow, [
      { id: "n_start", position: { x: 88, y: 66 } },
      { id: "n_wait", position: { x: 510, y: 280 } }
    ]);

    const start = next.nodes.find(node => node.id === "n_start");
    const wait = next.nodes.find(node => node.id === "n_wait");

    expect(start).toBeDefined();
    expect(wait).toBeDefined();
    expect(readNodePosition(start!)).toEqual({ x: 88, y: 66 });
    expect(readNodePosition(wait!)).toEqual({ x: 510, y: 280 });
  });
});
