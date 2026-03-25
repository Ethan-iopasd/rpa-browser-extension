import type { FlowModel } from "@rpa/flow-schema/generated/types";

export const sampleFlow: FlowModel = {
  schemaVersion: "1.0.0",
  id: "flow_demo_001",
  name: "打开页面并等待",
  variables: {
    _browserMode: "real",
    _browserHeadless: false
  },
  nodes: [
    { id: "n_start", type: "start", config: {} },
    { id: "n_nav", type: "navigate", config: { url: "https://example.com" } },
    { id: "n_wait", type: "wait", config: { ms: 1000 } },
    { id: "n_end", type: "end", config: {} }
  ],
  edges: [
    { id: "e1", source: "n_start", target: "n_nav" },
    { id: "e2", source: "n_nav", target: "n_wait" },
    { id: "e3", source: "n_wait", target: "n_end" }
  ]
};
