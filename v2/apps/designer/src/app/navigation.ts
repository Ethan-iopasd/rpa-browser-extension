import { useEffect, useState } from "react";

export type RouteParams = Record<string, string>;

function normalizePath(path: string): string {
  const value = path.trim();
  if (!value) {
    return "/";
  }
  if (value === "/") {
    return value;
  }
  return `/${value.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function splitPath(path: string): string[] {
  return normalizePath(path).split("/").filter(Boolean);
}

export function matchPath(pattern: string, pathname: string): RouteParams | null {
  const patternParts = splitPath(pattern);
  const pathParts = splitPath(pathname);
  if (patternParts.length !== pathParts.length) {
    return null;
  }
  const params: RouteParams = {};
  for (let idx = 0; idx < patternParts.length; idx += 1) {
    const expected = patternParts[idx];
    const actual = pathParts[idx];
    if (!expected || !actual) {
      return null;
    }
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) {
      return null;
    }
  }
  return params;
}

export function usePathname(): string {
  const [pathname, setPathname] = useState(() => normalizePath(window.location.pathname));

  useEffect(() => {
    const onChange = () => setPathname(normalizePath(window.location.pathname));
    window.addEventListener("popstate", onChange);
    window.addEventListener("rpa:navigate", onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener("rpa:navigate", onChange);
    };
  }, []);

  return pathname;
}

export function navigate(path: string): void {
  const nextPath = normalizePath(path);
  const current = normalizePath(window.location.pathname);
  if (current === nextPath) {
    return;
  }
  window.history.pushState({}, "", nextPath);
  window.dispatchEvent(new Event("rpa:navigate"));
}

export function replace(path: string): void {
  const nextPath = normalizePath(path);
  window.history.replaceState({}, "", nextPath);
  window.dispatchEvent(new Event("rpa:navigate"));
}

export function buildPath(template: string, params: RouteParams): string {
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`:${key}`, encodeURIComponent(value));
  }
  return normalizePath(result);
}
