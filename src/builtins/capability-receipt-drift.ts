import { defineCapability } from "../define.js";
import { assessReceiptDrift } from "../innovation.js";
import type { CapabilityReceipt } from "../types.js";

type Input = { baseline: CapabilityReceipt; current: CapabilityReceipt };

export default defineCapability<Input, ReturnType<typeof assessReceiptDrift>>({
  manifest: {
    specVersion: "0.1",
    id: "capability/receipt-drift",
    version: "1.0.0",
    name: "Receipt Drift Detector",
    description: "Detect behavioral, authority, and supply-chain drift between two executions, including the high-risk case where identical input produces different output under an apparently stable capability.",
    input: {
      type: "object",
      properties: { baseline: { type: "object" }, current: { type: "object" } },
      required: ["baseline", "current"]
    },
    output: {
      type: "object",
      properties: {
        severity: { type: "string" },
        reproducible: { type: "boolean" },
        changes: { type: "array" },
        score: { type: "number" }
      },
      required: ["severity", "reproducible", "changes", "score"]
    },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    tags: ["capability", "receipts", "drift", "reproducibility", "supply-chain"]
  },
  execute(input: Input) { return assessReceiptDrift(input.baseline, input.current); }
});
