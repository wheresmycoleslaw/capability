import { defineCapability } from "../define.js";

function segments(path: string): string[] {
  return path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
}

export default defineCapability<{ value: unknown; path: string }, { found: boolean; value?: unknown }>({
  manifest: {
    specVersion: "0.1",
    id: "json/get",
    version: "1.0.0",
    name: "Get JSON Path",
    description: "Read a dot/bracket path from structured data without executing expressions or accessing external resources.",
    input: { type: "object", properties: { value: {}, path: { type: "string" } }, required: ["value", "path"] },
    output: { type: "object", properties: { found: { type: "boolean" }, value: {} }, required: ["found"] },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    tags: ["json", "data", "path", "query"]
  },
  execute({ value, path }) {
    let current: unknown = value;
    for (const key of segments(path)) {
      if (current === null || typeof current !== "object" || !(key in current)) return { found: false };
      current = (current as Record<string, unknown>)[key];
    }
    return { found: true, value: current };
  }
});
