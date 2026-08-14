import { defineCapability } from "../define.js";
import { assessCapabilityNovelty } from "../innovation.js";
import type { CapabilityManifest } from "../types.js";

type Input = { proposed: CapabilityManifest; existing: CapabilityManifest[] };

export default defineCapability<Input, ReturnType<typeof assessCapabilityNovelty>>({
  manifest: {
    specVersion: "0.1",
    id: "capability/novelty-radar",
    version: "1.0.0",
    name: "Capability Novelty Radar",
    description: "Measure whether a proposed capability is a functional twin, incremental variation, distinct design, or genuinely novel ecosystem contribution by comparing contracts, effects, tags, and purpose signals.",
    input: {
      type: "object",
      properties: {
        proposed: { type: "object" },
        existing: { type: "array", items: { type: "object" } }
      },
      required: ["proposed", "existing"]
    },
    output: {
      type: "object",
      properties: {
        uniquenessScore: { type: "number" },
        classification: { type: "string" },
        nearest: { type: "array" },
        recommendation: { type: "string" }
      },
      required: ["uniquenessScore", "classification", "nearest", "recommendation"]
    },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    tags: ["capability", "innovation", "novelty", "duplicate-detection", "ecosystem-design"]
  },
  execute(input: Input) { return assessCapabilityNovelty(input.proposed, input.existing); }
});
