import { defineCapability } from "../define.js";
import { assessCapabilityEvolution } from "../evolution.js";
import type { CapabilityManifest } from "../types.js";

type Input = { previous: CapabilityManifest; next: CapabilityManifest };

export default defineCapability<Input, ReturnType<typeof assessCapabilityEvolution>>({
  manifest: {
    specVersion: "0.1",
    id: "capability/contract-evolution",
    version: "1.0.0",
    name: "Capability Contract Evolution Gate",
    description: "Classify whether a new capability version is safely substitutable by considering input/output compatibility, authority expansion, and behavioral guarantees that ordinary package versioning does not capture.",
    input: {
      type: "object",
      properties: { previous: { type: "object" }, next: { type: "object" } },
      required: ["previous", "next"]
    },
    output: {
      type: "object",
      properties: {
        classification: { type: "string" },
        semverRecommendation: { type: "string" },
        substitution: { type: "object" },
        changes: { type: "array" }
      },
      required: ["classification", "semverRecommendation", "substitution", "changes"]
    },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    tags: ["capability", "versioning", "contract", "effects", "compatibility", "upgrade"]
  },
  execute(input: Input) { return assessCapabilityEvolution(input.previous, input.next); }
});
