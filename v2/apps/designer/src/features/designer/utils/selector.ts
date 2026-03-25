export type SelectorType = "css" | "xpath" | "text" | "role" | "playwright";

export type SelectorCandidateModel = {
  id: string;
  type: SelectorType;
  value: string;
  score: number;
  primary: boolean;
};

export const SELECTOR_TYPE_OPTIONS: Array<{ value: SelectorType; label: string }> = [
  { value: "css", label: "CSS" },
  { value: "xpath", label: "XPath" },
  { value: "text", label: "Text" },
  { value: "role", label: "Role" },
  { value: "playwright", label: "Playwright" }
];

const TYPE_SET = new Set<SelectorType>(SELECTOR_TYPE_OPTIONS.map(item => item.value));
const PREFIX_BY_TYPE: Partial<Record<SelectorType, string>> = {
  xpath: "xpath=",
  text: "text=",
  role: "role=",
  css: "css="
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, value));
}

function trimPrefix(value: string, prefix: string): string {
  const normalized = value.trim();
  if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
    return normalized.slice(prefix.length).trim();
  }
  return normalized;
}

export function normalizeSelectorType(value: unknown): SelectorType {
  if (typeof value === "string" && TYPE_SET.has(value as SelectorType)) {
    return value as SelectorType;
  }
  return "css";
}

export function encodeSelector(type: SelectorType, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (type === "playwright") {
    return trimmed;
  }
  if (type === "css") {
    return trimPrefix(trimmed, "css=");
  }
  const prefix = PREFIX_BY_TYPE[type];
  if (!prefix) {
    return trimmed;
  }
  return `${prefix}${trimPrefix(trimmed, prefix)}`;
}

export function parseSelector(
  selector: unknown,
  selectorType?: unknown
): {
  type: SelectorType;
  value: string;
  encoded: string;
} {
  const raw = typeof selector === "string" ? selector.trim() : "";
  const preferredType = normalizeSelectorType(selectorType);

  if (!raw) {
    return {
      type: preferredType,
      value: "",
      encoded: ""
    };
  }

  const lowered = raw.toLowerCase();
  if (lowered.startsWith("xpath=")) {
    return { type: "xpath", value: trimPrefix(raw, "xpath="), encoded: raw };
  }
  if (lowered.startsWith("text=")) {
    return { type: "text", value: trimPrefix(raw, "text="), encoded: raw };
  }
  if (lowered.startsWith("role=")) {
    return { type: "role", value: trimPrefix(raw, "role="), encoded: raw };
  }
  if (lowered.startsWith("css=")) {
    return { type: "css", value: trimPrefix(raw, "css="), encoded: trimPrefix(raw, "css=") };
  }
  if (raw.startsWith("//") || raw.startsWith(".//") || raw.startsWith("(/")) {
    return { type: "xpath", value: raw, encoded: encodeSelector("xpath", raw) };
  }
  if (preferredType === "playwright") {
    return { type: "playwright", value: raw, encoded: raw };
  }
  if (preferredType !== "css") {
    return { type: preferredType, value: raw, encoded: encodeSelector(preferredType, raw) };
  }
  return { type: "css", value: raw, encoded: raw };
}

export function validateSelectorValue(type: SelectorType, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return "选择器不能为空。";
  }
  if (type === "xpath") {
    const raw = trimPrefix(trimmed, "xpath=");
    if (!(raw.startsWith("//") || raw.startsWith(".//") || raw.startsWith("(/"))) {
      return "XPath 建议以 // 或 .// 开头。";
    }
  }
  if (type === "role") {
    const raw = trimPrefix(trimmed, "role=");
    if (!raw.includes("=")) {
      return "Role 选择器建议包含角色与属性，例如 button[name='提交']。";
    }
  }
  return null;
}

export function normalizeSelectorCandidates(candidates: unknown): SelectorCandidateModel[] {
  if (!Array.isArray(candidates)) {
    return [];
  }

  const normalized = candidates
    .map((item, index) => {
      if (typeof item === "string") {
        const parsed = parseSelector(item);
        return {
          id: `candidate_${index + 1}`,
          type: parsed.type,
          value: parsed.value,
          score: 0.5,
          primary: index === 0
        } as SelectorCandidateModel;
      }

      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const parsed = parseSelector(record.value, record.type);
      return {
        id: `candidate_${index + 1}`,
        type: normalizeSelectorType(record.type ?? parsed.type),
        value: parsed.value,
        score: clampScore(typeof record.score === "number" ? record.score : 0.5),
        primary: Boolean(record.primary)
      } as SelectorCandidateModel;
    })
    .filter((item): item is SelectorCandidateModel => item !== null);

  if (normalized.length === 0) {
    return [];
  }
  if (!normalized.some(item => item.primary)) {
    const first = normalized[0];
    if (first) {
      normalized[0] = { ...first, primary: true };
    }
  }
  return normalized;
}

export function serializeSelectorCandidates(candidates: SelectorCandidateModel[]): Array<Record<string, unknown>> {
  const normalized = candidates
    .map((item, index) => ({
      ...item,
      id: item.id || `candidate_${index + 1}`,
      value: item.value.trim()
    }));

  if (normalized.length === 0) {
    return [];
  }
  const primaryIndex = normalized.findIndex(item => item.primary);
  const effectivePrimaryIndex = primaryIndex >= 0 ? primaryIndex : 0;

  return normalized.map((item, index) => ({
    type: item.type,
    value: encodeSelector(item.type, item.value),
    score: clampScore(item.score),
    primary: index === effectivePrimaryIndex
  }));
}
