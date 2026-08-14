import { defineCapability } from "../define.js";
import { calculateFailureFrontier, type FailureFrontierStep } from "../innovation.js";

type Input = { steps: FailureFrontierStep[] };

export default defineCapability<Input, ReturnType<typeof calculateFailureFrontier>>({
  manifest: {
    specVersion: "0.1",
    id: "capability/failure-frontier",
    version: "1.0.0",
    name: "Failure Frontier",
    description: "Locate the point of no return in a multi-capability plan, identify approval checkpoints, and quantify how much of the mutating path can be compensated or safely retried before execution starts.",
    input: {
      type: "object",
      properties: { steps: { type: "array", items: { type: "object" } } },
      required: ["steps"]
    },
    output: {
      type: "object",
      properties: {
        pointOfNoReturn: {},
        approvalCheckpoints: { type: "array" },
        retrySafePrefixLength: { type: "number" },
        compensationCoverage: { type: "number" },
        effects: { type: "array" }
      },
      required: ["pointOfNoReturn", "approvalCheckpoints", "retrySafePrefixLength", "compensationCoverage", "effects"]
    },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    tags: ["capability", "planning", "rollback", "failure", "risk", "point-of-no-return"]
  },
  execute(input: Input) { return calculateFailureFrontier(input.steps); }
});
