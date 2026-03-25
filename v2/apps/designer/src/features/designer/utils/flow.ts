import type { FlowEdge, FlowModel, FlowNode, NodeType } from "@rpa/flow-schema/generated/types";

import type { ApiError } from "../../../shared/types/api";
import type { FlowVersionRecord, ValidationState } from "../types";

export const VERSION_STORAGE_KEY = "rpa.flow.designer.versions.v1";
const NODE_UI_KEY = "__ui";

export type NodeCanvasPosition = {
  x: number;
  y: number;
};

const NODE_TYPE_LABELS: Record<NodeType, string> = {
  start: "开始",
  end: "结束",
  navigate: "打开页面",
  click: "点击",
  input: "输入",
  wait: "等待",
  extract: "提取",
  if: "条件",
  loop: "循环",
  hover: "悬停",
  scroll: "滚动",
  select: "下拉选择",
  upload: "上传文件",
  pressKey: "按键",
  doubleClick: "双击",
  rightClick: "右键",
  switchFrame: "切换框架",
  switchTab: "切换标签页",
  screenshot: "截图",
  assertText: "断言文本",
  assertVisible: "断言可见",
  assertUrl: "断言网址",
  assertCount: "断言数量",
  setVariable: "设置变量",
  templateRender: "模板渲染",
  jsonParse: "JSON 解析",
  regexExtract: "正则提取",
  tableExtract: "表格提取",
  rowLocate: "定位行",
  waitForVisible: "等待可见",
  waitForClickable: "等待可点击",
  waitForNetworkIdle: "等待网络空闲",
  waitForText: "等待文本",
  tryCatch: "异常处理",
  switchCase: "分支选择",
  parallel: "并行分支",
  break: "中断循环",
  continue: "继续循环",
  httpRequest: "HTTP 请求",
  webhook: "Webhook",
  dbQuery: "数据库查询",
  notify: "通知",
  subflow: "子流程"
};

export function getNodeTypeLabel(type: NodeType): string {
  return NODE_TYPE_LABELS[type];
}

export function deepCloneFlow(flow: FlowModel): FlowModel {
  return JSON.parse(JSON.stringify(flow)) as FlowModel;
}

export function createNode(type: NodeType, index: number): FlowNode {
  return {
    id: `${type}_${index}`,
    type,
    label: getNodeTypeLabel(type),
    config: withNodePosition(defaultNodeConfig(type), fallbackNodePosition(index))
  };
}

export function defaultNodeConfig(type: NodeType): Record<string, unknown> {
  switch (type) {
    case "navigate":
      return { url: "https://example.com" };
    case "click":
      return { selector: "#target", scopeSelector: "" };
    case "input":
      return { selector: "#input", text: "demo", scopeSelector: "" };
    case "wait":
      return { ms: 1000 };
    case "extract":
      return { selector: "h1", var: "pageTitle", scopeSelector: "" };
    case "if":
      return { expression: "{{flag}}" };
    case "loop":
      return { times: 2, source: "", itemVar: "item", indexVar: "index" };
    case "hover":
    case "doubleClick":
    case "rightClick":
    case "assertVisible":
    case "waitForVisible":
    case "waitForClickable":
      return { selector: "#target" };
    case "scroll":
      return { selector: "body", x: 0, y: 600 };
    case "select":
      return { selector: "#select", value: "option1" };
    case "upload":
      return { selector: "input[type='file']", filePath: "C:\\\\temp\\\\example.txt" };
    case "pressKey":
      return { key: "Enter" };
    case "switchFrame":
      return { selector: "iframe" };
    case "switchTab":
      return { index: 0 };
    case "screenshot":
      return { name: "snapshot" };
    case "assertText":
      return { selector: "body", expected: "success" };
    case "assertUrl":
      return { expected: "https://example.com", contains: true };
    case "assertCount":
      return { selector: ".item", expected: 1 };
    case "setVariable":
      return { key: "varName", value: "value" };
    case "templateRender":
      return { template: "Hello {{name}}", var: "renderedText" };
    case "jsonParse":
      return { source: "{{jsonText}}", var: "jsonValue" };
    case "regexExtract":
      return { source: "{{text}}", pattern: "(\\\\d+)", var: "matched" };
    case "tableExtract":
      return {
        selector: "table",
        scopeSelector: "",
        rowSelector: "tr",
        cellSelector: "th,td",
        useHeader: false,
        outputAs: "rows",
        var: "tableRows"
      };
    case "rowLocate":
      return {
        selector: "table",
        scopeSelector: "",
        rowSelector: "tr",
        cellSelector: "th,td",
        matchMode: "index",
        matchRules: [],
        rulesLogic: "all",
        rowIndex: 0,
        columnIndex: -1,
        text: "",
        caseSensitive: false,
        onNotFound: "fail",
        var: "locatedRow"
      };
    case "waitForNetworkIdle":
      return { timeoutMs: 8000 };
    case "waitForText":
      return { selector: "body", text: "loaded" };
    case "tryCatch":
      return {};
    case "switchCase":
      return { expression: "{{status}}", cases: ["success", "failed", "default"] };
    case "parallel":
      return {};
    case "break":
    case "continue":
      return {};
    case "httpRequest":
      return { method: "GET", url: "https://example.com/api" };
    case "webhook":
      return { url: "https://example.com/webhook", method: "POST", body: "{\"ok\":true}" };
    case "dbQuery":
      return { dbPath: "D:\\\\data\\\\app.db", query: "select 1 as value" };
    case "notify":
      return { channel: "log", message: "done" };
    case "subflow":
      return { flowId: "flow_sub_001" };
    default:
      return {};
  }
}

export function normalizeSwitchCaseOptions(raw: unknown): string[] {
  const values: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== "string") {
        continue;
      }
      const value = item.trim();
      if (value) {
        values.push(value);
      }
    }
  } else if (typeof raw === "string") {
    for (const token of raw.split(/[,\n]/)) {
      const value = token.trim();
      if (value) {
        values.push(value);
      }
    }
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    const key = item.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  if (!seen.has("default")) {
    deduped.push("default");
  }
  return deduped.slice(0, 8);
}

export function createEdge(source: string, target: string, index: number, condition?: string): FlowEdge {
  return {
    id: `edge_${index}`,
    source,
    target,
    condition: condition?.trim() || undefined
  };
}

export function readNodePosition(node: FlowNode, index = 0): NodeCanvasPosition {
  return readNodePositionFromConfig(node.config, index);
}

export function readNodePositionFromConfig(
  config: Record<string, unknown>,
  index = 0
): NodeCanvasPosition {
  const raw = config[NODE_UI_KEY];
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const x = Number(record.x);
    const y = Number(record.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { x, y };
    }
  }
  return fallbackNodePosition(index);
}

export function withNodePosition(
  config: Record<string, unknown>,
  position: NodeCanvasPosition
): Record<string, unknown> {
  return {
    ...config,
    [NODE_UI_KEY]: {
      x: Math.round(position.x),
      y: Math.round(position.y)
    }
  };
}

export function midpointPosition(a: NodeCanvasPosition, b: NodeCanvasPosition): NodeCanvasPosition {
  return {
    x: Math.round((a.x + b.x) / 2),
    y: Math.round((a.y + b.y) / 2)
  };
}

export function fallbackNodePosition(index: number): NodeCanvasPosition {
  const column = index % 4;
  const row = Math.floor(index / 4);
  return {
    x: 60 + column * 260,
    y: 80 + row * 170
  };
}

export function extractValidationErrors(state: ValidationState): string[] {
  if (!state) {
    return [];
  }
  if (isApiError(state)) {
    const errorList = state.details?.errors;
    if (!Array.isArray(errorList)) {
      return [state.message];
    }
    return errorList.filter(item => typeof item === "string");
  }
  if (state.valid) {
    return [];
  }
  return state.errors;
}

export function extractNodeIdsFromErrors(errors: string[]): string[] {
  const nodeIds = new Set<string>();
  const patterns = [/Node\s+([A-Za-z0-9_-]+)/g, /node\s+([A-Za-z0-9_-]+)/g, /:\s*([A-Za-z0-9_-]+)$/g];

  for (const message of errors) {
    for (const pattern of patterns) {
      const matches = message.matchAll(pattern);
      for (const match of matches) {
        const id = match[1];
        if (id) {
          nodeIds.add(id);
        }
      }
    }
  }

  return Array.from(nodeIds);
}

export function createVersionRecord(
  flow: FlowModel,
  mode: FlowVersionRecord["mode"],
  label?: string,
  sourceVersionId?: string
): FlowVersionRecord {
  const timestamp = Date.now();
  const createdAt = new Date(timestamp).toISOString();
  return {
    id: `ver_${timestamp}`,
    label: label?.trim() || defaultVersionLabel(mode, createdAt),
    mode,
    createdAt,
    sourceVersionId,
    flow: deepCloneFlow(flow)
  };
}

function defaultVersionLabel(mode: FlowVersionRecord["mode"], createdAt: string): string {
  const localTime = new Date(createdAt).toLocaleString("zh-CN", { hour12: false });
  if (mode === "published") {
    return `发布 ${localTime}`;
  }
  if (mode === "rollback") {
    return `回滚 ${localTime}`;
  }
  return `草稿 ${localTime}`;
}

export function parseVariableValue(raw: string): string | number | boolean | null {
  const text = raw.trim();
  if (text === "null") {
    return null;
  }
  if (text === "true") {
    return true;
  }
  if (text === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }
  return raw;
}

export function loadVersionsFromStorage(): FlowVersionRecord[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(VERSION_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isVersionRecord);
  } catch {
    return [];
  }
}

export function saveVersionsToStorage(versions: FlowVersionRecord[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(VERSION_STORAGE_KEY, JSON.stringify(versions));
}

function isVersionRecord(value: unknown): value is FlowVersionRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<FlowVersionRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.label === "string" &&
    typeof record.mode === "string" &&
    typeof record.createdAt === "string" &&
    !!record.flow
  );
}

function isApiError(value: ValidationState): value is ApiError {
  return !!value && typeof value === "object" && "code" in value && "message" in value;
}
