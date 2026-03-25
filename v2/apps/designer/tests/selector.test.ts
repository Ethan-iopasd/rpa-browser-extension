import { describe, expect, it } from "vitest";

import {
  encodeSelector,
  normalizeSelectorCandidates,
  parseSelector,
  serializeSelectorCandidates
} from "../src/features/designer/utils/selector";

describe("selector utils", () => {
  it("encodes xpath selector with prefix", () => {
    expect(encodeSelector("xpath", "//button[@id='submit']")).toBe("xpath=//button[@id='submit']");
  });

  it("parses prefixed selector type and value", () => {
    const parsed = parseSelector("text=立即提交");
    expect(parsed.type).toBe("text");
    expect(parsed.value).toBe("立即提交");
    expect(parsed.encoded).toBe("text=立即提交");
  });

  it("normalizes and serializes selector candidates", () => {
    const candidates = normalizeSelectorCandidates([
      { type: "xpath", value: "//button", score: 0.9, primary: true },
      { type: "css", value: "#submit", score: 0.5 }
    ]);
    const serialized = serializeSelectorCandidates(candidates);
    expect(serialized).toEqual([
      { type: "xpath", value: "xpath=//button", score: 0.9, primary: true },
      { type: "css", value: "#submit", score: 0.5, primary: false }
    ]);
  });
});
