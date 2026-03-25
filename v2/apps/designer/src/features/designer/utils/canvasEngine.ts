export type CanvasEngine = "reactflow" | "classic";

export const CANVAS_ENGINE_STORAGE_KEY = "rpa.flow.designer.canvas-engine.v1";

export function resolveInitialCanvasEngine(): CanvasEngine {
  if (typeof window === "undefined") {
    return "reactflow";
  }
  const fromStorage = window.localStorage.getItem(CANVAS_ENGINE_STORAGE_KEY);
  if (fromStorage === "classic" || fromStorage === "reactflow") {
    return fromStorage;
  }
  const fromEnv = import.meta.env.VITE_DESIGNER_CANVAS_ENGINE;
  if (fromEnv === "classic" || fromEnv === "reactflow") {
    return fromEnv;
  }
  return "reactflow";
}
