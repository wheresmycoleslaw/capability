import { defineCapability } from "../define.js";
import { routeCapabilityContracts } from "../innovation.js";
import type { JsonSchema } from "../types.js";

type Input = { producerOutput?: JsonSchema; consumers: { id: string; input?: JsonSchema }[] };

export default defineCapability<Input, ReturnType<typeof routeCapabilityContracts>>({
  manifest: {
    specVersion: "0.1",
    id: "capability/contract-router",
    version: "1.0.0",
    name: "Contract Router",
    description: "Determine which downstream capabilities can consume an upstream result without guessing, and derive the exact safe projection of compatible fields for automatic composition.",
    input: {
      type: "object",
      properties: {
        producerOutput: { type: "object" },
        consumers: { type: "array", items: { type: "object" } }
      },
      required: ["consumers"]
    },
    output: { type: "array", items: { type: "object" } },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    tags: ["capability", "composition", "routing", "contracts", "schema"]
  },
  execute(input: Input) { return routeCapabilityContracts(input.producerOutput, input.consumers); }
});
