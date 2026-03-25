export type NodeOutputSpec = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "array" | "object" | "any";
};

export function getNodeOutputSpecs(nodeType: string): NodeOutputSpec[] {
  switch (nodeType) {
    case "extract":
      return [{ key: "value", label: "Extracted text", type: "string" }];

    case "screenshot":
      return [{ key: "path", label: "Screenshot path", type: "string" }];

    case "if":
      return [{ key: "result", label: "Condition result", type: "boolean" }];

    case "loop":
      return [
        { key: "iteration", label: "Current iteration", type: "number" },
        { key: "item", label: "Current item", type: "any" },
        { key: "index", label: "Current index", type: "number" },
        { key: "count", label: "Total items", type: "number" },
      ];

    case "switchCase":
      return [{ key: "case", label: "Matched case", type: "string" }];

    case "setVariable":
      return [{ key: "value", label: "Assigned value", type: "any" }];

    case "templateRender":
      return [{ key: "value", label: "Rendered text", type: "string" }];

    case "jsonParse":
      return [{ key: "result", label: "Parsed value", type: "any" }];

    case "regexExtract":
      return [{ key: "result", label: "Regex result", type: "string" }];

    case "tableExtract":
      return [
        { key: "rows", label: "Raw rows", type: "array" },
        { key: "count", label: "Row count", type: "number" },
        { key: "first", label: "First row", type: "object" },
        { key: "records", label: "Record rows", type: "array" },
        { key: "recordCount", label: "Record count", type: "number" },
        { key: "firstRecord", label: "First record", type: "object" },
        { key: "headers", label: "Columns", type: "array" },
        { key: "rowSelectors", label: "Row selectors", type: "array" },
      ];

    case "rowLocate":
      return [
        { key: "selector", label: "Matched table selector", type: "string" },
        { key: "found", label: "Found row", type: "boolean" },
        { key: "rowSelector", label: "Matched row selector", type: "string" },
        { key: "rowIndex", label: "Matched row index", type: "number" },
        { key: "row", label: "Matched row cells", type: "array" },
        { key: "rowText", label: "Matched row text", type: "string" },
        { key: "record", label: "Matched row record", type: "object" },
      ];

    case "httpRequest":
    case "webhook":
      return [
        { key: "response", label: "Response body", type: "string" },
        { key: "body", label: "Response body alias", type: "string" },
        { key: "status", label: "HTTP status", type: "number" },
      ];

    case "dbQuery":
      return [
        { key: "rows", label: "Query rows", type: "array" },
        { key: "count", label: "Row count", type: "number" },
        { key: "first", label: "First row", type: "object" },
      ];

    case "assertUrl":
      return [{ key: "url", label: "Current URL", type: "string" }];

    default:
      return [];
  }
}

export function buildVariableRef(nodeId: string, key: string): string {
  return `{{${nodeId}.${key}}}`;
}

export function collectAvailableVariables(
  nodes: Array<{ id: string; type: string; label?: string }>
): Array<{
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  key: string;
  label: string;
  type: NodeOutputSpec["type"];
  ref: string;
}> {
  const result: ReturnType<typeof collectAvailableVariables> = [];
  for (const node of nodes) {
    const specs = getNodeOutputSpecs(node.type);
    for (const spec of specs) {
      result.push({
        nodeId: node.id,
        nodeLabel: node.label || node.type,
        nodeType: node.type,
        key: spec.key,
        label: spec.label,
        type: spec.type,
        ref: buildVariableRef(node.id, spec.key),
      });
    }
  }
  return result;
}
