import { useEffect, useMemo, useRef, useState } from "react";

import type { FlowModel, FlowNode, NodeType } from "@rpa/flow-schema/generated/types";

import {
  normalizeSelectorCandidates,
  parseSelector,
  SELECTOR_TYPE_OPTIONS,
  serializeSelectorCandidates,
  type SelectorCandidateModel,
  type SelectorType,
  validateSelectorValue
} from "../utils/selector";
import { getNodeTypeLabel } from "../utils/flow";
import { SelectorEditor } from "./SelectorEditor";
import { collectAvailableVariables } from "../utils/nodeOutputs";
import type { ElementPickerMode } from "../types";

type NodePanelProps = {
  flow?: FlowModel;
  selectedNode: FlowNode | null;
  onUpdateNode: (nodeId: string, patch: Partial<FlowNode>) => void;
  onUpdateNodeConfig: (nodeId: string, key: string, value: unknown) => void;
  onReplaceNodeConfig: (nodeId: string, config: Record<string, unknown>) => void;
  onRemoveNode: (nodeId: string) => void;
  onStartElementPicker?: (nodeId: string, url: string, mode?: ElementPickerMode) => void;
  desktopRuntime?: boolean;
  elementPickerHint?: string;
  onClose?: () => void;
};

const NODE_TYPES: NodeType[] = [
  "start",
  "end",
  "navigate",
  "click",
  "input",
  "wait",
  "extract",
  "hover",
  "scroll",
  "select",
  "upload",
  "pressKey",
  "doubleClick",
  "rightClick",
  "switchFrame",
  "switchTab",
  "screenshot",
  "assertText",
  "assertVisible",
  "assertUrl",
  "assertCount",
  "setVariable",
  "templateRender",
  "jsonParse",
  "regexExtract",
  "tableExtract",
  "rowLocate",
  "waitForVisible",
  "waitForClickable",
  "waitForNetworkIdle",
  "waitForText",
  "if",
  "loop",
  "tryCatch",
  "switchCase",
  "parallel",
  "break",
  "continue",
  "httpRequest",
  "webhook",
  "dbQuery",
  "notify",
  "subflow"
];

type SettingItem = {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "select";
  value: string | number | boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
};

type KatalonTemplateItem = {
  id: string;
  label: string;
  description: string;
  config: Record<string, unknown>;
};

const KATALON_TEMPLATES: KatalonTemplateItem[] = [
  {
    id: "katalon_smoke_chrome",
    label: "冒烟 / Chrome",
    description: "适合本地快速冒烟，默认 Chrome + default 执行配置。",
    config: {
      command: "katalonc",
      projectPath: "{{katalonProjectPath}}",
      testSuitePath: "Test Suites/Smoke",
      executionProfile: "default",
      browserType: "Chrome",
      reportFolder: "Reports/smoke",
      retry: 0,
      consoleLog: true,
      failOnNonZeroExit: true,
      extraArgs: []
    }
  },
  {
    id: "katalon_regression_chrome",
    label: "回归 / Chrome",
    description: "适合回归集执行，默认套件集合路径。",
    config: {
      command: "katalonc",
      projectPath: "{{katalonProjectPath}}",
      testSuiteCollectionPath: "Test Suites/Collections/Regression",
      executionProfile: "default",
      browserType: "Chrome",
      reportFolder: "Reports/regression",
      retry: 1,
      consoleLog: true,
      failOnNonZeroExit: true,
      extraArgs: []
    }
  },
  {
    id: "katalon_ci_headless",
    label: "CI / 无头模式",
    description: "适合 CI 环境，默认开启控制台日志并附加示例全局参数。",
    config: {
      command: "katalonc",
      projectPath: "{{katalonProjectPath}}",
      testSuiteCollectionPath: "Test Suites/Collections/CI",
      executionProfile: "ci",
      browserType: "Chrome",
      reportFolder: "Reports/ci",
      retry: 1,
      consoleLog: true,
      failOnNonZeroExit: true,
      extraArgs: ["-g_env=ci", "-g_headless=true"]
    }
  }
];

const KATALON_TEMPLATE_STORAGE_KEY = "rpa.flow.katalon.templates.v1";
const IF_OPERATOR_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "（兼容旧版）表达式真值判断" },
  { value: "truthy", label: "为真" },
  { value: "falsy", label: "为假" },
  { value: "exists", label: "存在" },
  { value: "empty", label: "为空" },
  { value: "eq", label: "==" },
  { value: "ne", label: "!=" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "contains", label: "包含" },
  { value: "in", label: "属于" },
  { value: "regex", label: "正则匹配" }
];
const VARIABLE_NORMALIZE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "none", label: "不处理" },
  { value: "boolean", label: "布尔" },
  { value: "number", label: "数字" },
  { value: "string", label: "字符串" },
  { value: "trim", label: "去首尾空格" },
  { value: "lower", label: "转小写" },
  { value: "upper", label: "转大写" }
];
const TEMPLATE_REF_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

type VariableProducer = {
  nodeId: string;
  nodeType: NodeType;
  label: string;
};

type IfVariableSource = {
  name: string;
  fromGlobalDefault: boolean;
  fromRuntimeInput: boolean;
  fromUpstreamNodes: VariableProducer[];
};

function extractTemplateVariableRefs(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) {
    return [];
  }
  const refs: string[] = [];
  const regex = new RegExp(TEMPLATE_REF_PATTERN.source, TEMPLATE_REF_PATTERN.flags);
  for (const match of raw.matchAll(regex)) {
    const key = match[1]?.trim();
    if (key) {
      refs.push(key);
    }
  }
  return refs;
}

function collectIfVariableRefs(config: Record<string, unknown>): string[] {
  const refs = [
    ...extractTemplateVariableRefs(config.expression),
    ...extractTemplateVariableRefs(config.left),
    ...extractTemplateVariableRefs(config.right)
  ];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const ref of refs) {
    if (seen.has(ref)) {
      continue;
    }
    seen.add(ref);
    unique.push(ref);
  }
  return unique;
}

function getNodeProducedVariable(node: FlowNode): string | null {
  const config = node.config;
  if (node.type === "setVariable") {
    const key = typeof config.key === "string" ? config.key.trim() : "";
    return key || null;
  }
  if (
    node.type === "extract" ||
    node.type === "templateRender" ||
    node.type === "jsonParse" ||
    node.type === "regexExtract" ||
    node.type === "tableExtract" ||
    node.type === "rowLocate" ||
    node.type === "httpRequest" ||
    node.type === "webhook" ||
    node.type === "dbQuery" ||
    node.type === "screenshot"
  ) {
    const variable = typeof config.var === "string" ? config.var.trim() : "";
    return variable || null;
  }
  if (node.type === "subflow") {
    const variable = typeof config.outputVar === "string" ? config.outputVar.trim() : "";
    return variable || null;
  }
  return null;
}

function collectUpstreamNodeIds(flow: FlowModel, targetNodeId: string): Set<string> {
  const incomingByTarget = new Map<string, string[]>();
  for (const edge of flow.edges) {
    const list = incomingByTarget.get(edge.target) ?? [];
    list.push(edge.source);
    incomingByTarget.set(edge.target, list);
  }
  const visited = new Set<string>();
  const stack = [...(incomingByTarget.get(targetNodeId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    const incoming = incomingByTarget.get(current) ?? [];
    for (const upstream of incoming) {
      if (!visited.has(upstream)) {
        stack.push(upstream);
      }
    }
  }
  return visited;
}

function normalizeKatalonTemplateConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const record = value as Record<string, unknown>;
  const config: Record<string, unknown> = {};
  for (const [key, candidate] of Object.entries(record)) {
    if (Array.isArray(candidate)) {
      config[key] = candidate.filter(item => typeof item === "string");
      continue;
    }
    if (
      typeof candidate === "string" ||
      typeof candidate === "number" ||
      typeof candidate === "boolean" ||
      candidate === null
    ) {
      config[key] = candidate;
    }
  }
  return config;
}

function loadCustomKatalonTemplates(): KatalonTemplateItem[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(KATALON_TEMPLATE_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(item => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const record = item as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id.trim() : "";
        const label = typeof record.label === "string" ? record.label.trim() : "";
        const description = typeof record.description === "string" ? record.description.trim() : "";
        if (!id || !label) {
          return null;
        }
        return {
          id,
          label,
          description: description || "自定义模板",
          config: normalizeKatalonTemplateConfig(record.config)
        } as KatalonTemplateItem;
      })
      .filter((item): item is KatalonTemplateItem => item !== null);
  } catch {
    return [];
  }
}

function saveCustomKatalonTemplates(templates: KatalonTemplateItem[]): void {
  if (typeof window === "undefined") {
    return;
  }
  const payload = templates.map(item => ({
    id: item.id,
    label: item.label,
    description: item.description,
    config: normalizeKatalonTemplateConfig(item.config)
  }));
  window.localStorage.setItem(KATALON_TEMPLATE_STORAGE_KEY, JSON.stringify(payload));
}

function buildSettingRows(node: FlowNode): SettingItem[] {
  const config = node.config;
  const rows: SettingItem[] = [];

  const addSelector = (label = "选择器") =>
    rows.push({ key: "selector", label, type: "text", value: asString(config.selector) });
  const addScopeSelector = (label = "作用域选择器（可选）") =>
    rows.push({
      key: "scopeSelector",
      label,
      type: "text",
      value: asString(config.scopeSelector),
      placeholder: "例如：tr:nth-of-type(2) / .row.active"
    });
  const addTimeout = () =>
    rows.push({ key: "timeoutMs", label: "超时（毫秒）", type: "number", value: asNumber(config.timeoutMs, 5000) });
  const addRetry = () =>
    rows.push({ key: "maxRetries", label: "最大重试次数", type: "number", value: asNumber(config.maxRetries, 0) });
  const addAutoWait = (defaultState: string) => {
    const timeoutFallback = asNumber(config.timeoutMs, 5000);
    rows.push({ key: "autoWait", label: "自动等待", type: "boolean", value: asBoolean(config.autoWait, true) });
    rows.push({
      key: "waitState",
      label: "等待状态",
      type: "text",
      value: asString(config.waitState || defaultState),
      placeholder: "可填：visible / enabled / editable / attached"
    });
    rows.push({
      key: "waitTimeoutMs",
      label: "等待超时（毫秒）",
      type: "number",
      value: asNumber(config.waitTimeoutMs, timeoutFallback)
    });
  };

  switch (node.type) {
    case "navigate":
      rows.push({ key: "url", label: "页面地址（URL）", type: "text", value: asString(config.url) });
      addTimeout();
      addRetry();
      break;
    case "click":
    case "doubleClick":
    case "rightClick":
      addSelector();
      addScopeSelector();
      addAutoWait("enabled");
      addTimeout();
      addRetry();
      break;
    case "hover":
      addSelector();
      addScopeSelector();
      addAutoWait("visible");
      addTimeout();
      addRetry();
      break;
    case "input":
      addSelector();
      addScopeSelector();
      rows.push({ key: "text", label: "输入文本", type: "text", value: asString(config.text ?? config.value) });
      addAutoWait("editable");
      addTimeout();
      addRetry();
      break;
    case "wait":
      rows.push({ key: "ms", label: "等待（毫秒）", type: "number", value: asNumber(config.ms, 1000) });
      break;
    case "extract":
      addSelector();
      addScopeSelector();
      rows.push({ key: "var", label: "输出变量", type: "text", value: asString(config.var) });
      addAutoWait("visible");
      addTimeout();
      addRetry();
      break;
    case "scroll":
      addSelector("选择器（可选）");
      addScopeSelector();
      rows.push({ key: "x", label: "横向偏移 X", type: "number", value: asNumber(config.x, 0) });
      rows.push({ key: "y", label: "纵向偏移 Y", type: "number", value: asNumber(config.y, 500) });
      addAutoWait("visible");
      addTimeout();
      break;
    case "select":
      addSelector();
      addScopeSelector();
      rows.push({ key: "value", label: "选项值", type: "text", value: asString(config.value) });
      addAutoWait("visible");
      addTimeout();
      addRetry();
      break;
    case "upload":
      addSelector();
      addScopeSelector();
      rows.push({ key: "filePath", label: "文件路径", type: "text", value: asString(config.filePath) });
      addAutoWait("visible");
      addTimeout();
      addRetry();
      break;
    case "pressKey":
      rows.push({
        key: "key",
        label: "按键",
        type: "text",
        value: asString(config.key),
        placeholder: "例如：Enter / Tab / Control+A"
      });
      addTimeout();
      break;
    case "switchFrame":
      rows.push({ key: "selector", label: "iframe 选择器", type: "text", value: asString(config.selector) });
      rows.push({ key: "url", label: "iframe 地址（URL）", type: "text", value: asString(config.url) });
      rows.push({ key: "index", label: "iframe 索引", type: "number", value: asNumber(config.index, 0) });
      addTimeout();
      break;
    case "switchTab":
      rows.push({ key: "index", label: "标签页索引", type: "number", value: asNumber(config.index, 0) });
      rows.push({ key: "url", label: "打开 URL", type: "text", value: asString(config.url) });
      addTimeout();
      break;
    case "screenshot":
      rows.push({ key: "name", label: "截图名称", type: "text", value: asString(config.name) });
      rows.push({ key: "fullPage", label: "整页截图", type: "boolean", value: asBoolean(config.fullPage, true) });
      rows.push({ key: "var", label: "输出变量", type: "text", value: asString(config.var) });
      break;
    case "assertText":
      addSelector();
      addScopeSelector();
      rows.push({ key: "expected", label: "期望文本", type: "text", value: asString(config.expected) });
      rows.push({ key: "contains", label: "包含匹配", type: "boolean", value: asBoolean(config.contains, true) });
      addAutoWait("visible");
      addTimeout();
      break;
    case "assertVisible":
      addSelector();
      addScopeSelector();
      addTimeout();
      break;
    case "assertUrl":
      rows.push({ key: "expected", label: "期望 URL", type: "text", value: asString(config.expected) });
      rows.push({ key: "contains", label: "包含匹配", type: "boolean", value: asBoolean(config.contains, true) });
      break;
    case "assertCount":
      addSelector();
      addScopeSelector();
      rows.push({ key: "expected", label: "期望数量", type: "number", value: asNumber(config.expected, 1) });
      addAutoWait("attached");
      addTimeout();
      break;
    case "setVariable":
      rows.push({ key: "key", label: "变量名", type: "text", value: asString(config.key) });
      rows.push({ key: "value", label: "变量值", type: "text", value: asString(config.value) });
      rows.push({ key: "source", label: "来源模板", type: "text", value: asString(config.source), placeholder: "{{name}}" });
      rows.push({
        key: "normalizeAs",
        label: "规范化方式",
        type: "select",
        value: asString(config.normalizeAs || "none"),
        options: VARIABLE_NORMALIZE_OPTIONS
      });
      if (String(config.normalizeAs || "").trim().toLowerCase() === "boolean") {
        rows.push({
          key: "trueValues",
          label: "真值词表",
          type: "text",
          value: asString(config.trueValues),
          placeholder: "例如：true,1,yes,on,ok,success,passed"
        });
        rows.push({
          key: "falseValues",
          label: "假值词表",
          type: "text",
          value: asString(config.falseValues),
          placeholder: "例如：false,0,no,off,fail,failed,error"
        });
        rows.push({
          key: "defaultBoolean",
          label: "默认布尔值（可选）",
          type: "text",
          value: asString(config.defaultBoolean),
          placeholder: "false"
        });
      }
      break;
    case "templateRender":
      rows.push({ key: "template", label: "模板", type: "text", value: asString(config.template) });
      rows.push({ key: "var", label: "输出变量", type: "text", value: asString(config.var) });
      break;
    case "jsonParse":
      rows.push({ key: "source", label: "JSON 来源", type: "text", value: asString(config.source) });
      rows.push({ key: "path", label: "JSON 路径", type: "text", value: asString(config.path), placeholder: "a.b.c" });
      rows.push({ key: "var", label: "输出变量", type: "text", value: asString(config.var) });
      break;
    case "regexExtract":
      rows.push({ key: "source", label: "来源", type: "text", value: asString(config.source) });
      rows.push({ key: "pattern", label: "正则", type: "text", value: asString(config.pattern) });
      rows.push({ key: "group", label: "分组", type: "number", value: asNumber(config.group, 1) });
      rows.push({ key: "var", label: "输出变量", type: "text", value: asString(config.var) });
      break;
    case "tableExtract":
      addSelector("表格选择器");
      addScopeSelector();
      rows.push({ key: "rowSelector", label: "行选择器", type: "text", value: asString(config.rowSelector || "tr") });
      rows.push({ key: "cellSelector", label: "列选择器", type: "text", value: asString(config.cellSelector || "th,td") });
      rows.push({ key: "useHeader", label: "首行作为表头", type: "boolean", value: asBoolean(config.useHeader, false) });
      rows.push({
        key: "columns",
        label: "列名（可选）",
        type: "text",
        value: asString(config.columns),
        placeholder: "例如：name,email,status"
      });
      rows.push({
        key: "outputAs",
        label: "变量输出格式",
        type: "select",
        value: asString(config.outputAs || "rows"),
        options: [
          { value: "rows", label: "二维数组 rows" },
          { value: "records", label: "对象数组 records" }
        ]
      });
      rows.push({ key: "var", label: "输出变量", type: "text", value: asString(config.var) });
      addTimeout();
      break;
    case "rowLocate":
      addSelector("列表/表格选择器");
      addScopeSelector();
      rows.push({ key: "rowSelector", label: "行选择器", type: "text", value: asString(config.rowSelector || "tr") });
      rows.push({ key: "cellSelector", label: "列选择器", type: "text", value: asString(config.cellSelector || "th,td") });
      rows.push({
        key: "matchMode",
        label: "匹配模式",
        type: "select",
        value: asString(config.matchMode || "index"),
        options: [
          { value: "index", label: "按行号" },
          { value: "contains", label: "包含文本" },
          { value: "equals", label: "等于文本" },
          { value: "regex", label: "正则匹配" }
        ]
      });
      rows.push({
        key: "rulesLogic",
        label: "多条件逻辑",
        type: "select",
        value: asString(config.rulesLogic || "all"),
        options: [
          { value: "all", label: "全部满足（AND）" },
          { value: "any", label: "任一满足（OR）" }
        ]
      });
      rows.push({
        key: "matchRules",
        label: "多条件规则（JSON）",
        type: "text",
        value: asJsonText(config.matchRules),
        placeholder: "[{\"mode\":\"contains\",\"text\":\"Alice\",\"columnIndex\":0}]"
      });
      rows.push({ key: "rowIndex", label: "行号（从 0 开始）", type: "number", value: asNumber(config.rowIndex, 0) });
      rows.push({ key: "columnIndex", label: "列号（-1 表示整行）", type: "number", value: asNumber(config.columnIndex, -1) });
      rows.push({ key: "text", label: "匹配文本/正则", type: "text", value: asString(config.text) });
      rows.push({ key: "caseSensitive", label: "区分大小写", type: "boolean", value: asBoolean(config.caseSensitive, false) });
      rows.push({
        key: "onNotFound",
        label: "未命中处理",
        type: "select",
        value: asString(config.onNotFound || "fail"),
        options: [
          { value: "fail", label: "报错失败" },
          { value: "branch", label: "走 notFound 分支" }
        ]
      });
      rows.push({ key: "var", label: "输出变量", type: "text", value: asString(config.var) });
      addTimeout();
      break;
    case "waitForVisible":
    case "waitForClickable":
      addSelector();
      addScopeSelector();
      addTimeout();
      break;
    case "waitForNetworkIdle":
      rows.push({ key: "timeoutMs", label: "超时（毫秒）", type: "number", value: asNumber(config.timeoutMs, 8000) });
      break;
    case "waitForText":
      addSelector();
      addScopeSelector();
      rows.push({ key: "text", label: "等待文本", type: "text", value: asString(config.text) });
      addTimeout();
      break;
    case "if":
      rows.push({
        key: "expression",
        label: "表达式（兼容旧版）",
        type: "text",
        value: asString(config.expression ?? config.value),
        placeholder: "{{isLoginOk}}"
      });
      rows.push({
        key: "left",
        label: "左值（结构化）",
        type: "text",
        value: asString(config.left),
        placeholder: "{{isLoginOk}}"
      });
      rows.push({
        key: "operator",
        label: "操作符（结构化）",
        type: "select",
        value: asString(config.operator),
        options: IF_OPERATOR_OPTIONS
      });
      rows.push({
        key: "right",
        label: "右值（结构化）",
        type: "text",
        value: asString(config.right),
        placeholder: "例如：true / success / 200"
      });
      break;
    case "switchCase":
      rows.push({
        key: "expression",
        label: "表达式",
        type: "text",
        value: asString(config.expression ?? config.value),
        placeholder: "{{status}}"
      });
      rows.push({
        key: "cases",
        label: "分支值",
        type: "text",
        value: Array.isArray(config.cases)
          ? config.cases.filter(item => typeof item === "string").join(", ")
          : asString(config.cases),
        placeholder: "例如：success, failed, default"
      });
      break;
    case "loop":
      rows.push({
        key: "source",
        label: "遍历数据源（可选）",
        type: "text",
        value: asString(config.source),
        placeholder: "例如：{{tableExtract_1.records}}"
      });
      rows.push({
        key: "itemVar",
        label: "当前项变量名",
        type: "text",
        value: asString(config.itemVar || "item"),
        placeholder: "item"
      });
      rows.push({
        key: "indexVar",
        label: "索引变量名",
        type: "text",
        value: asString(config.indexVar || "index"),
        placeholder: "index"
      });
      rows.push({
        key: "times",
        label: "循环次数（未设置数据源时生效）",
        type: "number",
        value: asNumber(config.times, 2)
      });
      break;
    case "httpRequest":
    case "webhook":
      rows.push({ key: "method", label: "请求方法（HTTP）", type: "text", value: asString(config.method || "GET") });
      rows.push({ key: "url", label: "请求 URL", type: "text", value: asString(config.url) });
      rows.push({ key: "body", label: "请求体", type: "text", value: asString(config.body) });
      rows.push({ key: "var", label: "输出变量", type: "text", value: asString(config.var) });
      addTimeout();
      addRetry();
      break;
    case "dbQuery":
      rows.push({ key: "dbPath", label: "数据库路径", type: "text", value: asString(config.dbPath) });
      rows.push({ key: "query", label: "SQL 语句", type: "text", value: asString(config.query) });
      rows.push({ key: "var", label: "输出变量", type: "text", value: asString(config.var) });
      break;
    case "notify":
      rows.push({ key: "channel", label: "通道", type: "text", value: asString(config.channel || "log") });
      rows.push({ key: "message", label: "消息", type: "text", value: asString(config.message) });
      break;
    case "subflow":
      rows.push({ key: "flowId", label: "子流程 ID", type: "text", value: asString(config.flowId) });
      rows.push({ key: "outputVar", label: "输出变量", type: "text", value: asString(config.outputVar) });
      rows.push({ key: "timeoutMs", label: "超时（毫秒）", type: "number", value: asNumber(config.timeoutMs, 600000) });
      break;
    default:
      break;
  }

  return rows;
}

function validateSelectorCandidates(candidates: SelectorCandidateModel[]): string[] {
  const errors: string[] = [];
  if (candidates.some(item => !item.value.trim())) {
    errors.push("选择器候选存在空值。");
  }
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const value = candidate.value.trim();
    if (!value) {
      continue;
    }
    const key = `${candidate.type}:${value}`;
    if (seen.has(key)) {
      errors.push("选择器候选存在重复项。");
      break;
    }
    seen.add(key);
  }
  return errors;
}

type UpstreamVar = ReturnType<typeof collectAvailableVariables>[number];

/** 上游变量插入选择器：点击展开下拉，选择变量后在光标处插入 {{nodeId.key}} */
function UpstreamVariablePicker({
  vars,
  onInsert,
}: {
  vars: UpstreamVar[];
  onInsert: (ref: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // 按 nodeId 分组
  const grouped = vars.reduce<Record<string, UpstreamVar[]>>((acc, v) => {
    acc[v.nodeId] ??= [];
    acc[v.nodeId]!.push(v);
    return acc;
  }, {});

  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        title="插入上游变量引用"
        className="!bg-none h-full px-2 rounded border !border-indigo-200 !bg-indigo-50 !text-indigo-600 hover:!bg-indigo-100 text-xs font-mono transition-colors focus:outline-none"
        onClick={() => setOpen(prev => !prev)}
      >
        {"{x}"}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-72 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="px-3 py-2 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            上游节点输出变量
          </div>
          <div className="max-h-60 overflow-y-auto">
            {Object.entries(grouped).map(([nodeId, nodeVars]) => (
              <div key={nodeId} className="border-b border-slate-50 last:border-0">
                <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 bg-slate-50/80 font-mono">
                  {nodeVars[0]?.nodeLabel ?? nodeId} <span className="text-slate-300">· {nodeId.slice(0, 8)}</span>
                </div>
                {nodeVars.map(v => (
                  <button
                    key={v.key}
                    type="button"
                    className="!bg-none w-full text-left px-3 py-1.5 text-xs hover:!bg-indigo-50 flex items-center justify-between gap-2 transition-colors focus:outline-none"
                    onClick={() => { onInsert(v.ref); setOpen(false); }}
                  >
                    <span className="font-mono text-indigo-700">{`{{${nodeId}.${v.key}}}`}</span>
                    <span className="text-slate-400 truncate flex-shrink-0 text-[10px]">{v.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function NodePanel(props: NodePanelProps) {
  const {
    flow,
    selectedNode,
    onUpdateNode,
    onUpdateNodeConfig,
    onReplaceNodeConfig,
    onRemoveNode,
    onStartElementPicker,
    desktopRuntime = false,
    elementPickerHint,
    onClose
  } = props;

  const [rawConfigText, setRawConfigText] = useState("{}");
  const [rawConfigNodeId, setRawConfigNodeId] = useState<string | null>(null);
  const [configError, setConfigError] = useState("");
  const [showRawConfig, setShowRawConfig] = useState(false);
  const [customKatalonTemplates, setCustomKatalonTemplates] = useState<KatalonTemplateItem[]>(() =>
    loadCustomKatalonTemplates()
  );
  const [katalonTemplateId, setKatalonTemplateId] = useState<string>(KATALON_TEMPLATES[0]?.id ?? "");
  const candidateIdRef = useRef(1);

  const settings = useMemo(() => (selectedNode ? buildSettingRows(selectedNode) : []), [selectedNode]);
  const allKatalonTemplates = useMemo(
    () => [...KATALON_TEMPLATES, ...customKatalonTemplates],
    [customKatalonTemplates]
  );

  // 上游节点输出变量列表，供参数面板的变量选择器使用
  const upstreamVars = useMemo(() => {
    if (!flow || !selectedNode) return [];
    const upstreamIds = collectUpstreamNodeIds(flow, selectedNode.id);
    const upstreamNodes = flow.nodes
      .filter(n => upstreamIds.has(n.id))
      .map(n => ({ id: n.id, type: n.type, label: n.label }));
    return collectAvailableVariables(upstreamNodes);
  }, [flow, selectedNode]);

  useEffect(() => {
    saveCustomKatalonTemplates(customKatalonTemplates);
  }, [customKatalonTemplates]);

  useEffect(() => {
    if (allKatalonTemplates.length === 0) {
      if (katalonTemplateId) {
        setKatalonTemplateId("");
      }
      return;
    }
    if (!allKatalonTemplates.some(item => item.id === katalonTemplateId)) {
      setKatalonTemplateId(allKatalonTemplates[0]?.id ?? "");
    }
  }, [allKatalonTemplates, katalonTemplateId]);

  if (!selectedNode) {
    return (
      <div className="bg-white/60 backdrop-blur border border-slate-200 shadow-sm rounded-xl p-6 flex flex-col items-center justify-center text-center min-h-[300px]">
        <h3 className="text-slate-800 font-bold text-lg mb-1">未选中节点</h3>
        <p className="text-slate-500 text-sm">请在画布上选择一个节点后再编辑配置。</p>
      </div>
    );
  }

  const node = selectedNode;
  const activeRawConfigText =
    rawConfigNodeId === node.id ? rawConfigText : JSON.stringify(node.config ?? {}, null, 2);
  const selectorSetting = settings.find(setting => setting.key === "selector") ?? null;
  const parsedSelector = parseSelector(node.config.selector, node.config.selectorType);
  const selectorWarning =
    selectorSetting && parsedSelector.value.trim()
      ? validateSelectorValue(parsedSelector.type, parsedSelector.value)
      : null;
  const selectorCandidates = normalizeSelectorCandidates(node.config.selectorCandidates);
  const selectorCandidateErrors = validateSelectorCandidates(selectorCandidates);
  const framePathString = asString(node.config.framePathString);
  const frameLocatorChain = Array.isArray(node.config.frameLocatorChain)
    ? node.config.frameLocatorChain
      .map(item => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const record = item as Record<string, unknown>;
        const primary = typeof record.primary === "string" ? record.primary.trim() : "";
        const hint = typeof record.hint === "string" ? record.hint.trim() : "";
        if (primary && !looksLikeDynamicFrameLabel(primary)) {
          return primary;
        }
        return hint || primary || "";
      })
      .filter(Boolean)
    : [];
  const subflowKatalon =
    node.type === "subflow" && node.config.katalon && typeof node.config.katalon === "object"
      ? (node.config.katalon as Record<string, unknown>)
      : null;
  const selectedKatalonTemplate =
    allKatalonTemplates.find(item => item.id === katalonTemplateId) ?? allKatalonTemplates[0] ?? null;
  const selectedIsBuiltIn = Boolean(
    selectedKatalonTemplate && KATALON_TEMPLATES.some(item => item.id === selectedKatalonTemplate.id)
  );
  const ifVariableSources = useMemo<IfVariableSource[]>(() => {
    if (!flow || node.type !== "if") {
      return [];
    }
    const refs = collectIfVariableRefs(node.config);
    if (refs.length === 0) {
      return [];
    }
    const upstreamIds = collectUpstreamNodeIds(flow, node.id);
    const upstreamWriters = flow.nodes
      .filter(candidate => upstreamIds.has(candidate.id))
      .map(candidate => {
        const producedVar = getNodeProducedVariable(candidate);
        return producedVar
          ? {
            producedVar,
            producer: {
              nodeId: candidate.id,
              nodeType: candidate.type,
              label: candidate.label || getNodeTypeLabel(candidate.type)
            } as VariableProducer
          }
          : null;
      })
      .filter((item): item is { producedVar: string; producer: VariableProducer } => item !== null);
    const globalVariables = flow.variables ?? {};
    return refs.map(name => ({
      name,
      fromGlobalDefault: Object.prototype.hasOwnProperty.call(globalVariables, name),
      fromRuntimeInput: true,
      fromUpstreamNodes: upstreamWriters
        .filter(item => item.producedVar === name)
        .map(item => item.producer)
    }));
  }, [flow, node]);

  function applyConfigText() {
    try {
      const parsed = JSON.parse(activeRawConfigText) as Record<string, unknown>;
      onReplaceNodeConfig(node.id, parsed);
      setConfigError("");
    } catch {
      setConfigError("JSON 配置格式无效。");
    }
  }

  function toggleRawConfig() {
    if (showRawConfig) {
      setShowRawConfig(false);
      return;
    }
    setRawConfigNodeId(node.id);
    setRawConfigText(JSON.stringify(node.config ?? {}, null, 2));
    setConfigError("");
    setShowRawConfig(true);
  }

  function updateSelectorCandidates(nextCandidates: SelectorCandidateModel[]) {
    onUpdateNodeConfig(node.id, "selectorCandidates", serializeSelectorCandidates(nextCandidates));
  }

  function syncSelectorFromPrimaryCandidate(candidates: SelectorCandidateModel[]) {
    const primary = candidates.find(candidate => candidate.primary) ?? candidates[0];
    if (!primary) {
      return;
    }
    const selectorValue = typeof primary.value === "string" ? primary.value.trim() : "";
    if (!selectorValue) {
      return;
    }
    onUpdateNodeConfig(node.id, "selector", selectorValue);
    onUpdateNodeConfig(node.id, "selectorType", primary.type);
  }

  function updateSelectorCandidate(
    candidateId: string,
    patch: Partial<Pick<SelectorCandidateModel, "type" | "value" | "score" | "primary">>
  ) {
    const nextCandidates = selectorCandidates.map(candidate =>
      candidate.id === candidateId ? { ...candidate, ...patch } : candidate
    );
    updateSelectorCandidates(nextCandidates);
    const edited = nextCandidates.find(candidate => candidate.id === candidateId);
    if (edited?.primary) {
      syncSelectorFromPrimaryCandidate(nextCandidates);
    }
  }

  function setPrimaryCandidate(candidateId: string) {
    const nextCandidates = selectorCandidates.map(candidate => ({
        ...candidate,
        primary: candidate.id === candidateId
      }));
    updateSelectorCandidates(nextCandidates);
    syncSelectorFromPrimaryCandidate(nextCandidates);
  }

  function appendCandidate(defaultType?: SelectorType, defaultValue?: string) {
    const nextCandidateId = `candidate_${candidateIdRef.current}`;
    candidateIdRef.current += 1;
    const nextCandidates = [
      ...selectorCandidates,
      {
        id: nextCandidateId,
        type: defaultType ?? parsedSelector.type,
        value: defaultValue ?? parsedSelector.value,
        score: 0.5,
        primary: selectorCandidates.length === 0
      }
    ];
    updateSelectorCandidates(nextCandidates);
    if (selectorCandidates.length === 0) {
      syncSelectorFromPrimaryCandidate(nextCandidates);
    }
  }

  function removeCandidate(candidateId: string) {
    const nextCandidates = selectorCandidates.filter(candidate => candidate.id !== candidateId);
    if (nextCandidates.length > 0 && !nextCandidates.some(candidate => candidate.primary)) {
      const first = nextCandidates[0];
      if (first) {
        nextCandidates[0] = { ...first, primary: true };
      }
    }
    updateSelectorCandidates(nextCandidates);
    if (nextCandidates.length > 0) {
      syncSelectorFromPrimaryCandidate(nextCandidates);
    }
  }

  function handleStartElementPicker() {
    if (!onStartElementPicker) {
      return;
    }

    const configUrl = asString(node.config.pageUrl).trim();
    const hasConfigUrl = /^https?:\/\//i.test(configUrl);
    const lastUrl = window.localStorage.getItem("rpa.flow.picker.last-url") || "";
    const fallbackUrl = lastUrl.trim();
    const hasFallbackUrl = /^https?:\/\//i.test(fallbackUrl);
    const url = hasConfigUrl ? configUrl : (hasFallbackUrl ? fallbackUrl : "");
    if (url) {
      window.localStorage.setItem("rpa.flow.picker.last-url", url);
    }
    const pickerMode: ElementPickerMode | undefined = desktopRuntime ? "desktop_native" : undefined;
    onStartElementPicker(node.id, url, pickerMode);
  }

  function setSubflowKatalonEnabled(enabled: boolean) {
    if (node.type !== "subflow") {
      return;
    }
    const nextConfig: Record<string, unknown> = { ...node.config };
    if (!enabled) {
      delete nextConfig.katalon;
      onReplaceNodeConfig(node.id, nextConfig);
      return;
    }
    const current = subflowKatalon ?? {};
    nextConfig.katalon = {
      command: asString(current.command) || "katalonc",
      projectPath: asString(current.projectPath) || "{{katalonProjectPath}}",
      testSuitePath: asString(current.testSuitePath) || "Test Suites/Smoke",
      executionProfile: asString(current.executionProfile) || "default",
      browserType: asString(current.browserType) || "Chrome",
      reportFolder: asString(current.reportFolder),
      retry: asNumber(current.retry, 0),
      consoleLog: asBoolean(current.consoleLog, true),
      failOnNonZeroExit: asBoolean(current.failOnNonZeroExit, true),
      extraArgs: Array.isArray(current.extraArgs)
        ? current.extraArgs
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map(item => item.trim())
        : []
    };
    onReplaceNodeConfig(node.id, nextConfig);
  }

  function updateSubflowKatalonField(field: string, value: unknown) {
    if (node.type !== "subflow") {
      return;
    }
    const nextConfig: Record<string, unknown> = { ...node.config };
    const nextKatalon: Record<string, unknown> = subflowKatalon ? { ...subflowKatalon } : {};
    nextKatalon[field] = value;
    nextConfig.katalon = nextKatalon;
    onReplaceNodeConfig(node.id, nextConfig);
  }

  function applyKatalonTemplate() {
    if (node.type !== "subflow" || !selectedKatalonTemplate) {
      return;
    }
    const current = subflowKatalon ?? {};
    const nextKatalon: Record<string, unknown> = {
      ...selectedKatalonTemplate.config
    };
    const existingProjectPath = asString(current.projectPath).trim();
    const existingCommand = asString(current.command).trim();
    if (existingProjectPath) {
      nextKatalon.projectPath = existingProjectPath;
    }
    if (existingCommand) {
      nextKatalon.command = existingCommand;
    }
    const nextConfig: Record<string, unknown> = {
      ...node.config,
      katalon: nextKatalon
    };
    onReplaceNodeConfig(node.id, nextConfig);
  }

  function saveAsCustomKatalonTemplate() {
    if (node.type !== "subflow" || !subflowKatalon) {
      window.alert("请先开启 Katalon 执行并填写配置。");
      return;
    }
    const defaultLabel = `自定义模板 ${customKatalonTemplates.length + 1}`;
    const labelInput = window.prompt("请输入模板名称", defaultLabel);
    const label = labelInput ? labelInput.trim() : "";
    if (!label) {
      return;
    }
    const descriptionInput = window.prompt("请输入模板说明（可选）", "自定义模板");
    const description = descriptionInput ? descriptionInput.trim() : "自定义模板";
    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setCustomKatalonTemplates(prev => [
      ...prev,
      {
        id,
        label,
        description: description || "自定义模板",
        config: normalizeKatalonTemplateConfig(subflowKatalon)
      }
    ]);
    setKatalonTemplateId(id);
  }

  function updateSelectedCustomTemplate() {
    if (!selectedKatalonTemplate || selectedIsBuiltIn) {
      window.alert("请选择一个自定义模板后再更新。");
      return;
    }
    if (node.type !== "subflow" || !subflowKatalon) {
      window.alert("当前节点没有可保存的 Katalon 配置。");
      return;
    }
    setCustomKatalonTemplates(prev =>
      prev.map(item =>
        item.id === selectedKatalonTemplate.id
          ? {
            ...item,
            config: normalizeKatalonTemplateConfig(subflowKatalon)
          }
          : item
      )
    );
  }

  function renameSelectedCustomTemplate() {
    if (!selectedKatalonTemplate || selectedIsBuiltIn) {
      window.alert("请选择一个自定义模板后再重命名。");
      return;
    }
    const nextLabelInput = window.prompt("请输入新的模板名称", selectedKatalonTemplate.label);
    const nextLabel = nextLabelInput ? nextLabelInput.trim() : "";
    if (!nextLabel) {
      return;
    }
    const nextDescriptionInput = window.prompt("请输入新的模板说明（可选）", selectedKatalonTemplate.description);
    const nextDescription = nextDescriptionInput ? nextDescriptionInput.trim() : selectedKatalonTemplate.description;
    setCustomKatalonTemplates(prev =>
      prev.map(item =>
        item.id === selectedKatalonTemplate.id
          ? {
            ...item,
            label: nextLabel,
            description: nextDescription || "自定义模板"
          }
          : item
      )
    );
  }

  function deleteSelectedCustomTemplate() {
    if (!selectedKatalonTemplate || selectedIsBuiltIn) {
      window.alert("请选择一个自定义模板后再删除。");
      return;
    }
    const confirmed = window.confirm(`确认删除模板“${selectedKatalonTemplate.label}”？`);
    if (!confirmed) {
      return;
    }
    setCustomKatalonTemplates(prev => prev.filter(item => item.id !== selectedKatalonTemplate.id));
  }

  return (
    <div className="bg-white/80 backdrop-blur shadow-md shadow-slate-200/50 border border-slate-200 rounded-xl flex flex-col overflow-hidden h-full">
      <header className="px-5 py-4 border-b border-slate-100 bg-white flex items-center justify-between sticky top-0 z-10">
        <div>
          <h2 className="text-base font-bold text-slate-800 m-0">节点配置</h2>
          <p className="text-xs text-slate-400 m-0 mt-1">编辑当前选中步骤的参数</p>
        </div>
        <div className="flex items-center gap-2">
          {onClose ? (
            <button
              type="button"
              className="!bg-none !bg-transparent !border-transparent !shadow-none text-slate-400 hover:!text-slate-700 p-1.5 rounded"
              onClick={onClose}
              title="关闭"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : null}
          <button
            type="button"
            className="!bg-none !bg-transparent !border-transparent !shadow-none text-slate-400 hover:!text-red-500 p-1.5 rounded"
            onClick={() => onRemoveNode(node.id)}
            title="删除节点"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </header>

      <div className="p-4 flex flex-col gap-4 overflow-y-auto">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">节点 ID</span>
          <input className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono" value={node.id} readOnly />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">名称</span>
          <input
            className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
            value={node.label ?? ""}
            onChange={event => onUpdateNode(node.id, { label: event.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">类型</span>
          <select
            className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
            value={node.type}
            onChange={event => onUpdateNode(node.id, { type: event.target.value as NodeType })}
          >
            {NODE_TYPES.map(type => (
              <option key={type} value={type}>
                {getNodeTypeLabel(type)} - {type}
              </option>
            ))}
          </select>
        </label>

        <div className="h-px bg-slate-100 w-full" />

        <div className="grid grid-cols-1 gap-3">
          {settings.map(setting => {
            if (setting.key === "selector") {
              return (
                <div key={`${node.id}_${setting.key}`} className="-mx-1 px-1">
                  <SelectorEditor
                    label={setting.label}
                    selector={node.config.selector}
                    selectorType={node.config.selectorType}
                    onChange={(nextSelector, nextType) => {
                      onUpdateNodeConfig(node.id, "selector", nextSelector);
                      onUpdateNodeConfig(node.id, "selectorType", nextType);
                    }}
                  />
                </div>
              );
            }
            return (
              <label key={`${node.id}_${setting.key}`} className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">{setting.label}</span>
                {setting.type === "boolean" ? (
                  <select
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
                    value={String(setting.value)}
                    onChange={event => onUpdateNodeConfig(node.id, setting.key, event.target.value === "true")}
                  >
                    <option value="true">是</option>
                    <option value="false">否</option>
                  </select>
                ) : setting.type === "select" ? (
                  <select
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
                    value={String(setting.value)}
                    onChange={event => onUpdateNodeConfig(node.id, setting.key, event.target.value)}
                  >
                    {(setting.options ?? []).map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex gap-1">
                    <input
                      className="flex-1 min-w-0 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
                      type={setting.type}
                      value={setting.type === "number" ? Number(setting.value) : String(setting.value)}
                      placeholder={setting.placeholder}
                      id={`field_${node.id}_${setting.key}`}
                      onChange={event =>
                        onUpdateNodeConfig(
                          node.id,
                          setting.key,
                          setting.type === "number" ? Number(event.target.value) : event.target.value
                        )
                      }
                    />
                    {setting.type === "text" && upstreamVars.length > 0 && (
                      <UpstreamVariablePicker
                        vars={upstreamVars}
                        onInsert={ref => {
                          const el = document.getElementById(`field_${node.id}_${setting.key}`) as HTMLInputElement | null;
                          if (el) {
                            const start = el.selectionStart ?? el.value.length;
                            const end = el.selectionEnd ?? el.value.length;
                            const next = el.value.slice(0, start) + ref + el.value.slice(end);
                            onUpdateNodeConfig(node.id, setting.key, next);
                          } else {
                            onUpdateNodeConfig(node.id, setting.key, String(setting.value) + ref);
                          }
                        }}
                      />
                    )}
                  </div>
                )}
              </label>
            );
          })}
        </div>

        {node.type === "if" ? (
          <>
            <div className="h-px bg-slate-100 w-full" />
            <div className="flex flex-col gap-2">
              <h3 className="text-[11px] font-bold text-indigo-500 uppercase tracking-wider m-0">变量来源分析</h3>
              {ifVariableSources.length === 0 ? (
                <div className="text-[11px] text-slate-500 border border-dashed border-slate-200 rounded px-3 py-2">
                  未检测到变量占位符（例如 {'{{isLoginOk}}'}）。当前 if 会按字面值判断。
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {ifVariableSources.map(source => (
                    <div key={source.name} className="border border-slate-200 rounded-lg px-3 py-2 bg-slate-50/70">
                      <div className="text-xs font-mono text-slate-800">{source.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${source.fromGlobalDefault
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-slate-100 text-slate-500 border border-slate-200"
                            }`}
                        >
                          {source.fromGlobalDefault ? "全局默认值" : "未在全局定义"}
                        </span>
                        {source.fromRuntimeInput ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            运行入参可覆盖
                          </span>
                        ) : null}
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${source.fromUpstreamNodes.length > 0
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : "bg-slate-100 text-slate-500 border border-slate-200"
                            }`}
                        >
                          {source.fromUpstreamNodes.length > 0
                            ? `上游节点覆盖 (${source.fromUpstreamNodes.length})`
                            : "未检测到上游覆盖"}
                        </span>
                      </div>
                      {source.fromUpstreamNodes.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {source.fromUpstreamNodes.map(producer => (
                            <span
                              key={`${source.name}-${producer.nodeId}`}
                              className="px-1.5 py-0.5 rounded border border-amber-200 bg-white text-[10px] text-amber-800 font-mono"
                            >
                              {producer.label}#{producer.nodeId}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                读取优先级：运行入参 {'>'} 上游节点写入 {'>'} 全局默认值。
              </div>
            </div>
          </>
        ) : null}

        {node.type === "subflow" ? (
          <>
            <div className="h-px bg-slate-100 w-full" />
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-bold text-indigo-500 uppercase tracking-wider m-0">Katalon 执行</h3>
                <select
                  className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs"
                  value={subflowKatalon ? "true" : "false"}
                  onChange={event => setSubflowKatalonEnabled(event.target.value === "true")}
                >
                  <option value="false">关闭（普通子流程）</option>
                  <option value="true">开启（Katalon CLI）</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-slate-600">配置模板</span>
                  <select
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
                    value={selectedKatalonTemplate?.id || ""}
                    onChange={event => setKatalonTemplateId(event.target.value)}
                  >
                    {allKatalonTemplates.map(template => (
                      <option key={template.id} value={template.id}>
                        {template.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="self-end !bg-none !bg-indigo-500 hover:!bg-indigo-600 !text-white px-3 py-2 rounded text-xs font-semibold !border-transparent"
                  onClick={applyKatalonTemplate}
                  disabled={!selectedKatalonTemplate}
                >
                  一键填充
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="!bg-none !bg-emerald-500 hover:!bg-emerald-600 !text-white px-2.5 py-1.5 rounded text-xs font-semibold !border-transparent"
                  onClick={saveAsCustomKatalonTemplate}
                >
                  保存为模板
                </button>
                <button
                  type="button"
                  className="!bg-none !bg-slate-100 hover:!bg-slate-200 !text-slate-700 px-2.5 py-1.5 rounded text-xs font-semibold !border-slate-200"
                  onClick={updateSelectedCustomTemplate}
                  disabled={!selectedKatalonTemplate || selectedIsBuiltIn}
                >
                  更新模板
                </button>
                <button
                  type="button"
                  className="!bg-none !bg-slate-100 hover:!bg-slate-200 !text-slate-700 px-2.5 py-1.5 rounded text-xs font-semibold !border-slate-200"
                  onClick={renameSelectedCustomTemplate}
                  disabled={!selectedKatalonTemplate || selectedIsBuiltIn}
                >
                  重命名
                </button>
                <button
                  type="button"
                  className="!bg-none !bg-red-50 hover:!bg-red-100 !text-red-700 px-2.5 py-1.5 rounded text-xs font-semibold !border-red-200"
                  onClick={deleteSelectedCustomTemplate}
                  disabled={!selectedKatalonTemplate || selectedIsBuiltIn}
                >
                  删除模板
                </button>
              </div>
              {selectedKatalonTemplate ? (
                <div className="text-[11px] text-slate-500 bg-indigo-50 border border-indigo-200 rounded px-2 py-1">
                  {selectedKatalonTemplate.description}
                  <span className="ml-1 text-indigo-600">
                    {selectedIsBuiltIn ? "（内置）" : "（自定义）"}
                  </span>
                </div>
              ) : null}
              <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                开启后将通过执行端调用 `katalonc` 执行。`projectPath` 必须是执行端机器上的本地路径。
              </div>
              {subflowKatalon ? (
                <div className="grid grid-cols-1 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-600">命令</span>
                    <input
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm font-mono"
                      value={asString(subflowKatalon.command)}
                      placeholder="katalonc"
                      onChange={event => updateSubflowKatalonField("command", event.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-600">项目路径</span>
                    <input
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm font-mono"
                      value={asString(subflowKatalon.projectPath)}
                      placeholder="{{katalonProjectPath}}"
                      onChange={event => updateSubflowKatalonField("projectPath", event.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-600">测试套件路径</span>
                    <input
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
                      value={asString(subflowKatalon.testSuitePath)}
                      placeholder="Test Suites/Smoke"
                      onChange={event => updateSubflowKatalonField("testSuitePath", event.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-600">套件集合路径</span>
                    <input
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
                      value={asString(subflowKatalon.testSuiteCollectionPath)}
                      placeholder="Test Suites/Collections/Regression"
                      onChange={event => updateSubflowKatalonField("testSuiteCollectionPath", event.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-600">执行配置</span>
                    <input
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
                      value={asString(subflowKatalon.executionProfile)}
                      placeholder="default"
                      onChange={event => updateSubflowKatalonField("executionProfile", event.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-600">浏览器类型</span>
                    <input
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
                      value={asString(subflowKatalon.browserType)}
                      placeholder="Chrome"
                      onChange={event => updateSubflowKatalonField("browserType", event.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-600">报告目录</span>
                    <input
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
                      value={asString(subflowKatalon.reportFolder)}
                      placeholder="Reports/smoke"
                      onChange={event => updateSubflowKatalonField("reportFolder", event.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-600">重试次数</span>
                    <input
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
                      type="number"
                      value={asNumber(subflowKatalon.retry, 0)}
                      onChange={event => updateSubflowKatalonField("retry", Number(event.target.value))}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-600">附加参数（空格分隔）</span>
                    <input
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm font-mono"
                      value={
                        Array.isArray(subflowKatalon.extraArgs)
                          ? subflowKatalon.extraArgs
                            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
                            .join(" ")
                          : ""
                      }
                      placeholder="--config -g_build=smoke"
                      onChange={event =>
                        updateSubflowKatalonField(
                          "extraArgs",
                          event.target.value
                            .split(/\s+/)
                            .map(item => item.trim())
                            .filter(Boolean)
                        )
                      }
                    />
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-slate-600">控制台日志</span>
                      <select
                        className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
                        value={String(asBoolean(subflowKatalon.consoleLog, true))}
                        onChange={event => updateSubflowKatalonField("consoleLog", event.target.value === "true")}
                      >
                        <option value="true">是</option>
                        <option value="false">否</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-slate-600">非零退出即失败</span>
                      <select
                        className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
                        value={String(asBoolean(subflowKatalon.failOnNonZeroExit, true))}
                        onChange={event => updateSubflowKatalonField("failOnNonZeroExit", event.target.value === "true")}
                      >
                        <option value="true">是</option>
                        <option value="false">否</option>
                      </select>
                    </label>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-slate-500 border border-dashed border-slate-200 rounded px-3 py-2">
                  当前为普通子流程模式（基于 `flowId` 或内联 `flow`）。
                </div>
              )}
            </div>
          </>
        ) : null}

        {selectorSetting ? (
          <>
            <div className="h-px bg-slate-100 w-full" />
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-bold text-indigo-500 uppercase tracking-wider m-0">选择器候选</h3>
                <div className="flex items-center gap-1">
                  {onStartElementPicker ? (
                    <button
                      type="button"
                      className="!bg-none !bg-indigo-50 !shadow-none px-2 py-0.5 rounded border border-indigo-200 text-[11px] font-medium !text-indigo-700"
                      onClick={handleStartElementPicker}
                    >
                      页面拾取器
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="!bg-none !bg-transparent !shadow-none px-2 py-0.5 rounded border border-slate-200 text-[11px] font-medium !text-slate-600"
                    onClick={() => appendCandidate(parsedSelector.type, parsedSelector.value)}
                  >
                    + 复制当前
                  </button>
                  <button
                    type="button"
                    className="!bg-none !bg-transparent !shadow-none px-2 py-0.5 rounded border border-slate-200 text-[11px] font-medium !text-slate-600"
                    onClick={() => appendCandidate("css", "")}
                  >
                    + 新增空白
                  </button>
                </div>
              </div>
              {elementPickerHint ? (
                <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                  {elementPickerHint}
                </div>
              ) : null}

              {selectorCandidates.length === 0 ? (
                <div className="text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg px-3 py-2">
                  暂无候选选择器。
                </div>
              ) : null}

              {(framePathString || frameLocatorChain.length > 0) ? (
                <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-2.5 py-2 flex flex-col gap-1">
                  <span className="font-semibold text-slate-700">iframe 路径</span>
                  <span className="font-mono break-all">{framePathString || "top"}</span>
                  {frameLocatorChain.length > 0 ? (
                    <span className="font-mono break-all text-slate-500">
                      {frameLocatorChain.join(" -> ")}
                    </span>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                {selectorCandidates.map(candidate => (
                  <div key={candidate.id} className="flex flex-wrap sm:flex-nowrap gap-1.5 items-center border border-slate-200 bg-slate-50 rounded-lg p-1.5">
                    <select
                      className="px-2 py-1 bg-white border border-slate-200 rounded text-xs w-20 shrink-0"
                      value={candidate.type}
                      onChange={event =>
                        updateSelectorCandidate(candidate.id, {
                          type: event.target.value as SelectorType
                        })
                      }
                    >
                      {SELECTOR_TYPE_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <input
                      className="flex-1 min-w-[100px] px-2 py-1 bg-white border border-slate-200 rounded text-xs"
                      value={candidate.value}
                      placeholder="选择器"
                      onChange={event =>
                        updateSelectorCandidate(candidate.id, {
                          value: event.target.value
                        })
                      }
                    />
                    <div className="flex items-center gap-1.5 shrink-0 ml-auto sm:ml-0">
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.1}
                        className="w-14 px-1.5 py-1 bg-white border border-slate-200 rounded text-[11px] font-mono text-center"
                        value={candidate.score}
                        onChange={event =>
                          updateSelectorCandidate(candidate.id, {
                            score: Number(event.target.value)
                          })
                        }
                        title="分数 0-1"
                      />
                      <button
                        type="button"
                        className={`!bg-none !shadow-none px-2 py-1 rounded text-[10px] font-bold border ${candidate.primary
                          ? "bg-indigo-50 !border-indigo-200 !text-indigo-600"
                          : "!bg-transparent !border-slate-200 !text-slate-400"
                          }`}
                        onClick={() => setPrimaryCandidate(candidate.id)}
                      >
                        主候选
                      </button>
                      <button
                        type="button"
                        className="!bg-none !shadow-none flex items-center justify-center w-6 h-6 rounded border !border-transparent !text-slate-400"
                        onClick={() => removeCandidate(candidate.id)}
                        title="删除"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {selectorWarning ? (
                <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  {selectorWarning}
                </div>
              ) : null}
              {selectorCandidateErrors.length > 0 ? (
                <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
                  {selectorCandidateErrors.join(" ")}
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden mt-1">
          <button
            type="button"
            className="!bg-none !bg-transparent w-full flex items-center justify-between px-3 py-2 text-[11px] font-bold !text-slate-500 !shadow-none !border-transparent"
            onClick={toggleRawConfig}
          >
            <span>{showRawConfig ? "收起 JSON" : "编辑 JSON"}</span>
            <svg
              className={`w-3.5 h-3.5 transition-transform ${showRawConfig ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showRawConfig ? (
            <div className="p-2 flex flex-col gap-2 border-t border-slate-200 bg-white">
              <textarea
                className="px-2.5 py-2 bg-slate-800 text-indigo-100 border border-slate-700 rounded-md text-[11px] font-mono min-h-[140px] resize-y w-full"
                value={activeRawConfigText}
                onChange={event => {
                  setRawConfigNodeId(node.id);
                  setRawConfigText(event.target.value);
                }}
                spellCheck={false}
              />
              <button
                type="button"
                className="!bg-none self-end bg-indigo-500 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-md text-xs font-bold !border-transparent"
                onClick={applyConfigText}
              >
                应用 JSON
              </button>
            </div>
          ) : null}
        </div>

        {configError ? (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs font-medium">
            {configError}
          </div>
        ) : null}
      </div>

    </div>
  );
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
}

function asJsonText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) || (value && typeof value === "object")) {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function looksLikeDynamicFrameLabel(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  return [
    /\d{6,}/i,
    /[a-z][-_]?\d{5,}/i,
    /(?:^|[-_])iframe[-_]?[a-z0-9_-]*\d+(?:\.\d+)?$/i,
    /^x-[a-z0-9_-]*iframe[a-z0-9_-]*\d+(?:\.\d+)?$/i,
    /^frame[a-z]{1,8}\d+$/i
  ].some(pattern => pattern.test(normalized));
}
