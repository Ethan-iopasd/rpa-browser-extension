import type { ReactNode } from "react";

import { NavLink } from "./NavLink";

type BreadcrumbItem = {
  label: string;
  to?: string;
};

type ConsoleLayoutProps = {
  title: string;
  subtitle?: string;
  breadcrumbs?: BreadcrumbItem[];
  pathname: string;
  actions?: ReactNode;
  children: ReactNode;
};

const NAV_ITEMS = [
  {
    label: "总览",
    to: "/dashboard",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
        />
      </svg>
    )
  },
  {
    label: "流程",
    to: "/flows",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    )
  },
  {
    label: "日志",
    to: "/runs",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  },
  {
    label: "任务",
    to: "/tasks",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
        />
      </svg>
    )
  },
  {
    label: "安全",
    to: "/security/credentials",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
        />
      </svg>
    )
  },
  {
    label: "设置",
    to: "/settings",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )
  }
];

export function ConsoleLayout(props: ConsoleLayoutProps) {
  const { title, subtitle, breadcrumbs = [], pathname, actions, children } = props;

  return (
    <div className="min-h-screen grid grid-cols-[260px_1fr] bg-slate-50 text-slate-800 font-sans selection:bg-blue-200">
      <aside className="sticky top-0 h-screen border-r border-slate-200/60 bg-white/70 backdrop-blur-xl flex flex-col p-5 shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-10 transition-all duration-300">
        <header className="mb-8 pl-2 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </div>
          <div>
            <h1 className="m-0 text-base font-bold tracking-tight text-slate-900 leading-tight">Flow Console</h1>
            <p className="m-0 text-[11px] text-slate-400 font-medium uppercase tracking-widest mt-0.5">Workspace V2</p>
          </div>
        </header>
        <nav className="flex flex-col gap-1.5 flex-1">
          {NAV_ITEMS.map(item => {
            const isActive = pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 border border-transparent ${isActive
                  ? "bg-blue-50 text-blue-700 shadow-sm border-blue-100/50"
                  : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900"
                  }`}
              >
                <span className={`text-base transition-transform ${isActive ? "scale-110" : "opacity-70"}`}>{item.icon}</span>
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-auto p-4 rounded-xl bg-slate-100/50 border border-slate-200/50">
          <p className="text-xs text-slate-500 font-medium leading-relaxed">Agent 引擎连接正常</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <span className="text-xs text-slate-400 font-mono">v0.1.0-beta</span>
          </div>
        </div>
      </aside>

      <div className="flex flex-col min-w-0 bg-slate-50/50 relative">
        <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-b from-blue-50/50 to-transparent pointer-events-none -z-10" />

        <header className="flex justify-between items-center px-8 py-5">
          <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-400">
            {breadcrumbs.map((crumb, index) => (
              <span key={`${crumb.label}_${index}`} className="flex items-center gap-2">
                {crumb.to ? (
                  <NavLink to={crumb.to} className="text-blue-600 hover:text-blue-800 transition-colors">
                    {crumb.label}
                  </NavLink>
                ) : (
                  <span className="text-slate-600">{crumb.label}</span>
                )}
                {index < breadcrumbs.length - 1 && <span>/</span>}
              </span>
            ))}
          </div>
          {actions && <div className="flex items-center gap-3">{actions}</div>}
        </header>

        <section className="px-8 pb-4">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 mt-0 mb-1.5">{title}</h2>
          {subtitle && <p className="text-sm text-slate-500 m-0">{subtitle}</p>}
        </section>

        <section className="flex-1 px-8 pb-8 mt-4">{children}</section>
      </div>
    </div>
  );
}
