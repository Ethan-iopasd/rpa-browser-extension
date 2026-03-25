import { describe, expect, it } from "vitest";

import { resolveInitialCanvasEngine } from "../src/features/designer/utils/canvasEngine";

const STORAGE_KEY = "rpa.flow.designer.canvas-engine.v1";

describe("resolveInitialCanvasEngine", () => {
  it("prefers localStorage value when present", () => {
    window.localStorage.setItem(STORAGE_KEY, "classic");
    expect(resolveInitialCanvasEngine()).toBe("classic");
  });

  it("falls back to reactflow when localStorage value is invalid", () => {
    window.localStorage.setItem(STORAGE_KEY, "unexpected");
    expect(resolveInitialCanvasEngine()).toBe("reactflow");
  });
});
