import { defineCapability } from "../dist/index.js";

export default defineCapability({
  manifest: {
    specVersion: "0.1",
    id: "example/add",
    version: "1.0.0",
    name: "Add numbers",
    description: "Adds two numbers without side effects.",
    input: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
    output: { type: "object", properties: { result: { type: "number" } }, required: ["result"] },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    tags: ["math", "example"]
  },
  execute({ a, b }) { return { result: a + b }; }
});
