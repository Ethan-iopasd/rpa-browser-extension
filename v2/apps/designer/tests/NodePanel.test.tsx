import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FlowNode } from "@rpa/flow-schema/generated/types";

import { NodePanel } from "../src/features/designer/components/NodePanel";

function createNode(config: Record<string, unknown> = {}): FlowNode {
  return {
    id: "n_click",
    type: "click",
    label: "Click",
    config: {
      selector: "#submit",
      ...config
    }
  };
}

describe("NodePanel selector interaction", () => {
  it("updates selector and selectorType when switching to xpath", () => {
    const onUpdateNode = vi.fn();
    const onUpdateNodeConfig = vi.fn();
    const onReplaceNodeConfig = vi.fn();
    const onRemoveNode = vi.fn();

    render(
      <NodePanel
        selectedNode={createNode()}
        onUpdateNode={onUpdateNode}
        onUpdateNodeConfig={onUpdateNodeConfig}
        onReplaceNodeConfig={onReplaceNodeConfig}
        onRemoveNode={onRemoveNode}
      />
    );

    const selectorValueInput = screen
      .getAllByRole("textbox")
      .find(element => (element as HTMLInputElement).value === "#submit");
    const selectorTypeSelect = screen
      .getAllByRole("combobox")
      .find(element => within(element).queryByRole("option", { name: /xpath/i }) !== null);

    expect(selectorValueInput).toBeDefined();
    expect(selectorTypeSelect).toBeDefined();

    fireEvent.change(selectorValueInput as HTMLInputElement, {
      target: { value: "//button[@id='submit']" }
    });
    fireEvent.change(selectorTypeSelect as HTMLSelectElement, { target: { value: "xpath" } });

    expect(onUpdateNodeConfig.mock.calls).toEqual(
      expect.arrayContaining([["n_click", "selectorType", "xpath"]])
    );
    const selectorCalls = onUpdateNodeConfig.mock.calls.filter(
      (call: unknown[]) => call[0] === "n_click" && call[1] === "selector"
    );
    expect(selectorCalls.some(call => String(call[2]).startsWith("xpath="))).toBe(true);
  });

  it("appends structured selector candidate row", () => {
    const onUpdateNode = vi.fn();
    const onUpdateNodeConfig = vi.fn();
    const onReplaceNodeConfig = vi.fn();
    const onRemoveNode = vi.fn();

    render(
      <NodePanel
        selectedNode={createNode({ selectorCandidates: [] })}
        onUpdateNode={onUpdateNode}
        onUpdateNodeConfig={onUpdateNodeConfig}
        onReplaceNodeConfig={onReplaceNodeConfig}
        onRemoveNode={onRemoveNode}
      />
    );

    const addEmptyButtons = screen
      .getAllByRole("button")
      .filter(button => (button.textContent ?? "").trim().startsWith("+"));
    expect(addEmptyButtons.length).toBeGreaterThan(0);
    for (const button of addEmptyButtons) {
      fireEvent.click(button as HTMLButtonElement);
    }

    const candidateCall = onUpdateNodeConfig.mock.calls.find(
      (call: unknown[]) => call[0] === "n_click" && call[1] === "selectorCandidates"
    );
    expect(candidateCall).toBeDefined();
    expect(candidateCall?.[2]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "css",
          score: 0.5,
          primary: true
        })
      ])
    );
  });
});

