import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const schemaPath = resolve(packageRoot, "schema", "flow.schema.json");
const tsTypesPath = resolve(packageRoot, "generated", "types.ts");
const pyModelsPath = resolve(packageRoot, "generated", "flow_models.py");

const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
const tsTypes = readFileSync(tsTypesPath, "utf-8");
const pyModels = readFileSync(pyModelsPath, "utf-8");

const schemaVersion = schema.properties?.schemaVersion?.const;
const nodeTypes = schema.$defs?.nodeType?.enum ?? [];

const missing = [];

if (!tsTypes.includes(`FLOW_SCHEMA_VERSION = '${schemaVersion}'`)) {
  missing.push("TypeScript FLOW_SCHEMA_VERSION mismatch");
}

if (!pyModels.includes(`FLOW_SCHEMA_VERSION = "${schemaVersion}"`)) {
  missing.push("Python FLOW_SCHEMA_VERSION mismatch");
}

for (const nodeType of nodeTypes) {
  if (!tsTypes.includes(`'${nodeType}'`)) {
    missing.push(`TypeScript missing node type: ${nodeType}`);
  }
  if (!pyModels.includes(`"${nodeType}"`)) {
    missing.push(`Python missing node type: ${nodeType}`);
  }
}

if (missing.length > 0) {
  console.error("Schema and generated files are not synchronized:");
  for (const item of missing) {
    console.error(`- ${item}`);
  }
  process.exit(1);
}

console.log("Schema and generated files are synchronized.");
