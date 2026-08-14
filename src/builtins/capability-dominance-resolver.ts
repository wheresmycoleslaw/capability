import { defineCapability } from "../define.js";
import { resolveCapabilityDominance, type DominanceCandidate } from "../evolution.js";

type Input = { candidates: DominanceCandidate[] };

export default defineCapability<Input, ReturnType<typeof resolveCapabilityDominance>>({
  manifest: {
    specVersion: "0.1",
    id: "capability/dominance-resolver",
    version: "1.0.0",
    name: "Capability Dominance Resolver",
    description: "Find the non-dominated frontier among interchangeable capabilities without hiding tradeoffs inside one score, preferring candidates that are no worse on authority risk, trust, determinism, and reversibility.",
    input: {
      type: "object",
      properties: { candidates: { type: "array", items: { type: "object" } } },
      required: ["candidates"]
    },
    output: {
      type: "object",
      properties: { frontier: { type: "array" }, dominated: { type: "array" } },
      required: ["frontier", "dominated"]
    },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    tags: ["capability", "pareto", "selection", "authority", "trust", "substitution"]
  },
  execute(input: Input) { return resolveCapabilityDominance(input.candidates); }
});
