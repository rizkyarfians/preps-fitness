import { readFileSync, writeFileSync } from "node:fs";
const spec = JSON.parse(
  readFileSync(
    new URL("../../../packages/contracts/openapi.yaml", import.meta.url),
    "utf8",
  ),
);
function type(s) {
  if (s.nullable) return `(${type({ ...s, nullable: false })}) | null`;
  if (s.oneOf) return s.oneOf.map(type).map(t => `(${t})`).join(" | ");
  if (s.type === "integer") return "number";
  if (s.$ref) return s.$ref.split("/").at(-1);
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (s.type === "array") return `Array<${type(s.items)}>`;
  if (s.type === "object")
    return `{ ${Object.entries(s.properties || {})
      .map(
        ([k, v]) =>
          `${JSON.stringify(k)}${s.required?.includes(k) ? "" : "?"}: ${type(v)}`,
      )
      .join("; ")} }`;
  if (["string", "number", "boolean"].includes(s.type)) return s.type;
  throw new Error(`Unsupported schema: ${JSON.stringify(s)}`);
}
const out =
  "// Generated from packages/contracts/openapi.yaml. Run npm run contracts.\n" +
  Object.entries(spec.components.schemas)
    .map(([n, s]) => `export type ${n} = ${type(s)};`)
    .join("\n") +
  "\n";
const file = new URL("../src/contracts.ts", import.meta.url);
if (process.argv.includes("--check")) {
  if (readFileSync(file, "utf8") !== out)
    throw new Error("Contract types have drifted; run npm run contracts");
} else writeFileSync(file, out);
