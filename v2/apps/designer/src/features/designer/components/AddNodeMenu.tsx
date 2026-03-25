import { useEffect, useMemo, useRef, useState } from "react";

import type { NodeType } from "@rpa/flow-schema/generated/types";

import { getNodeTypeLabel } from "../utils/flow";

const NODE_CATEGORIES: Array<{ title: string; types: NodeType[] }> = [
  {
    title: "流程控制",
    types: ["start", "end", "if", "switchCase", "loop", "tryCatch", "parallel", "break", "continue", "subflow"]
  },
  {
    title: "浏览器交互",
    types: ["navigate", "click", "input", "hover", "scroll", "select", "upload", "pressKey", "doubleClick", "rightClick"]
  },
  {
    title: "提取与断言",
    types: ["extract", "tableExtract", "rowLocate", "screenshot", "assertText", "assertVisible", "assertUrl", "assertCount"]
  },
  {
    title: "等待与切换",
    types: ["wait", "waitForVisible", "waitForClickable", "waitForNetworkIdle", "waitForText", "switchTab", "switchFrame"]
  },
  {
    title: "数据与集成",
    types: ["setVariable", "templateRender", "jsonParse", "regexExtract", "httpRequest", "webhook", "dbQuery", "notify"]
  }
];

type AddNodeMenuProps = {
  position: { x: number; y: number };
  onSelect: (type: NodeType) => void;
  onClose: () => void;
  excludeStart?: boolean;
};

export function AddNodeMenu(props: AddNodeMenuProps) {
  const { position, onSelect, onClose, excludeStart } = props;
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filteredCategories = useMemo(() => {
    const term = search.toLowerCase();
    return NODE_CATEGORIES.map(cat => {
      const filteredTypes = cat.types.filter(type => {
        if (excludeStart && type === "start") {
          return false;
        }
        if (!term) {
          return true;
        }
        const label = getNodeTypeLabel(type).toLowerCase();
        return label.includes(term) || type.toLowerCase().includes(term);
      });
      return { ...cat, types: filteredTypes };
    }).filter(cat => cat.types.length > 0);
  }, [search, excludeStart]);

  return (
    <>
      <div
        className="fixed inset-0 z-[90] cursor-default"
        onClick={event => {
          event.stopPropagation();
          onClose();
        }}
        data-no-pan="true"
        title="点击空白处关闭菜单"
      />
      <div
        className="fixed bg-white/95 backdrop-blur-xl shadow-2xl rounded-xl border border-slate-200/80 w-[280px] flex flex-col overflow-hidden z-[100] animate-in slide-in-from-top-2 fade-in duration-200"
        style={{ left: position.x, top: position.y }}
        onClick={event => event.stopPropagation()}
        data-no-pan="true"
      >
        <div className="p-2 border-b border-slate-100 bg-slate-50/50">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all font-medium"
              placeholder="搜索节点名称或类型..."
              value={search}
              onChange={event => setSearch(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Escape") {
                  onClose();
                }
              }}
            />
          </div>
        </div>
        <div className="max-h-[min(50vh,360px)] overflow-y-auto p-1.5" style={{ scrollbarWidth: "thin" }}>
          {filteredCategories.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 font-medium">没有匹配的节点</div>
          ) : (
            filteredCategories.map(category => (
              <div key={category.title} className="mb-2 last:mb-0">
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {category.title}
                </div>
                <div className="flex flex-col gap-0.5">
                  {category.types.map(type => (
                    <button
                      key={type}
                      type="button"
                      className="flex items-center justify-between w-full text-left px-2.5 py-1.5 bg-none bg-transparent hover:bg-slate-100/60 rounded-lg group transition-colors border-transparent shadow-none !text-slate-700 hover:!text-indigo-700"
                      onClick={() => onSelect(type)}
                    >
                      <span className="text-[13px] font-medium transition-colors">{getNodeTypeLabel(type)}</span>
                      <span className="text-[10px] font-mono !text-slate-400 group-hover:!text-indigo-400 transition-colors">{type}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

