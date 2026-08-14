import { defineCapability } from "../define.js";
import { calculateAuthorityEnvelope } from "../innovation.js";
import type { CapabilityEffect, CapabilityManifest } from "../types.js";

type Input = { manifests: CapabilityManifest[]; requiredEffects?: CapabilityEffect[] };

export default defineCapability<Input, ReturnType<typeof calculateAuthorityEnvelope>>({
  manifest: {
    specVersion: "0.1",
    id: "capability/authority-envelope",
    version: "1.0.0",
    name: "Authority Envelope",
    description: "Compute the minimum visible authority surface of a capability set, expose over-declared permissions, and summarize reversibility and execution risk before an agent commits to a plan.",
    input: {
      type: "object",
      properties: {
        manifests: { type: "array", items: { type: "object" } },
        requiredEffects: { type: "array", items: { type: "string" } }
      },
      required: ["manifests"]
    },
    output: {
      type: "object",
      properties: {
        effects: { type: "array" },
        openWorldEffects: { type: "array" },
        overDeclaredEffects: { type: "array" },
        perCapabilityOverDeclaration: { type: "object" },
        riskScore: { type: "number" },
        deterministic: { type: "boolean" },
        fullyReversible: { type: "boolean" }
      },
      required: ["effects", "openWorldEffects", "overDeclaredEffects", "perCapabilityOverDeclaration", "riskScore", "deterministic", "fullyReversible"]
    },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    tags: ["capability", "least-authority", "permissions", "risk", "planning"]
  },
  execute(input: Input) { return calculateAuthorityEnvelope(input.manifests, input.requiredEffects); }
});
