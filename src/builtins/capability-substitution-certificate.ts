import { defineCapability } from "../define.js";
import { certifyCapabilitySubstitution, type SubstitutionTrust } from "../evolution.js";
import type { CapabilityManifest } from "../types.js";

type Input = {
  original: CapabilityManifest;
  replacement: CapabilityManifest;
  originalTrust?: SubstitutionTrust;
  replacementTrust?: SubstitutionTrust;
};

export default defineCapability<Input, ReturnType<typeof certifyCapabilitySubstitution>>({
  manifest: {
    specVersion: "0.1",
    id: "capability/substitution-certificate",
    version: "1.0.0",
    name: "Safe Substitution Certificate",
    description: "Certify whether one capability may replace another without expanding authority, weakening declared behavior, lowering trust, or breaking the conservative machine-readable contract.",
    input: {
      type: "object",
      properties: {
        original: { type: "object" },
        replacement: { type: "object" },
        originalTrust: { type: "object" },
        replacementTrust: { type: "object" }
      },
      required: ["original", "replacement"]
    },
    output: {
      type: "object",
      properties: {
        accepted: { type: "boolean" },
        original: { type: "object" },
        replacement: { type: "object" },
        authorityDelta: { type: "object" },
        behaviorRegressions: { type: "array" },
        contractBreaking: { type: "array" },
        trustRegression: { type: "boolean" },
        reasons: { type: "array" },
        certificate: { type: "string" }
      },
      required: ["accepted", "original", "replacement", "authorityDelta", "behaviorRegressions", "contractBreaking", "trustRegression", "reasons", "certificate"]
    },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    tags: ["capability", "substitution", "hot-swap", "authority", "trust", "contract"]
  },
  execute(input: Input) {
    return certifyCapabilitySubstitution(input.original, input.replacement, input.originalTrust, input.replacementTrust);
  }
});
