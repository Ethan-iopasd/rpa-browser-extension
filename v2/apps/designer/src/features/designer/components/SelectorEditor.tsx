import { useMemo } from "react";

import {
  encodeSelector,
  parseSelector,
  SELECTOR_TYPE_OPTIONS,
  type SelectorType,
  validateSelectorValue
} from "../utils/selector";

type SelectorEditorProps = {
  label: string;
  selector: unknown;
  selectorType?: unknown;
  placeholder?: string;
  onChange: (selector: string, selectorType: SelectorType) => void;
};

export function SelectorEditor(props: SelectorEditorProps) {
  const { label, selector, selectorType, placeholder, onChange } = props;
  const parsed = useMemo(() => parseSelector(selector, selectorType), [selector, selectorType]);
  const validationMessage = useMemo(
    () => (parsed.value.trim() ? validateSelectorValue(parsed.type, parsed.value) : null),
    [parsed.type, parsed.value]
  );

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <div className="grid grid-cols-[120px_1fr] gap-2">
        <select
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 outline-none"
          value={parsed.type}
          onChange={event => {
            const nextType = event.target.value as SelectorType;
            onChange(encodeSelector(nextType, parsed.value), nextType);
          }}
        >
          {SELECTOR_TYPE_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 outline-none placeholder:text-slate-300"
          value={parsed.value}
          placeholder={placeholder ?? "输入选择器..."}
          onChange={event => onChange(encodeSelector(parsed.type, event.target.value), parsed.type)}
        />
      </div>
      <div className="text-[11px] text-slate-500">
        执行值 <code className="bg-slate-100 px-1 py-0.5 rounded">{parsed.encoded || "(空)"}</code>
      </div>
      {validationMessage ? (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          {validationMessage}
        </div>
      ) : null}
    </div>
  );
}
