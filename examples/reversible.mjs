import { defineCapability } from "../dist/index.js";

const state = [];

export default defineCapability({
  manifest: {
    specVersion: "0.1",
    id: "example/append",
    version: "1.0.0",
    name: "Append value",
    description: "Demonstrates planning, approval, receipts, verification and rollback.",
    input: { type: "object", properties: { value: {} }, required: ["value"] },
    effects: ["database.write"],
    behavior: { deterministic: true, idempotent: false, reversible: true },
    tags: ["example", "rollback"]
  },
  plan(input) { return { summary: `Append ${JSON.stringify(input.value)} to the in-memory collection` }; },
  execute(input) { state.push(input.value); return { index: state.length - 1, value: input.value }; },
  verify(output) { return { ok: state[output.index] === output.value }; },
  rollback({ output }) { state.splice(output.index, 1); return { removed: output.value }; }
});
