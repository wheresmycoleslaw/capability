import { defineCapability } from "./define.js";
import type { Capability, CapabilityManifest, ExecutionOptions } from "./types.js";
import type { CapabilityRuntime } from "./runtime.js";
import { unique } from "./utils.js";

export type CompositionStep = {
  capability: Capability;
  mapInput?: (previous: unknown, original: unknown) => unknown | Promise<unknown>;
};

export function composeCapabilities(options: {
  manifest: Omit<CapabilityManifest, "effects" | "behavior"> & {
    effects?: CapabilityManifest["effects"];
    behavior?: CapabilityManifest["behavior"];
  };
  steps: readonly (Capability | CompositionStep)[];
}): Capability {
  const steps = options.steps.map((step) => "capability" in step ? step : { capability: step });
  const effects = unique(steps.flatMap((step) => step.capability.manifest.effects ?? []));
  if (options.manifest.effects) {
    const missing = effects.filter((effect) => !options.manifest.effects?.includes(effect));
    if (missing.length) throw new TypeError(`Composed manifest omits required effects: ${missing.join(", ")}`);
  }
  const deterministic = steps.every((step) => step.capability.manifest.behavior?.deterministic === true);
  const idempotent = steps.every((step) => step.capability.manifest.behavior?.idempotent === true);
  return defineCapability({
    manifest: {
      ...options.manifest,
      effects: options.manifest.effects ?? effects,
      behavior: options.manifest.behavior ?? { deterministic, idempotent, reversible: false }
    },
    async execute(input, context) {
      let value: unknown = input;
      for (const step of steps) {
        const stepInput = step.mapInput ? await step.mapInput(value, input) : value;
        value = await step.capability.execute(stepInput, { ...context, manifest: step.capability.manifest });
      }
      return value;
    }
  });
}

export async function runPipeline(runtime: CapabilityRuntime, capabilityIds: readonly string[], input: unknown, options: ExecutionOptions = {}): Promise<{ output: unknown; receipts: string[] }> {
  let value = input;
  const receipts: string[] = [];
  for (const id of capabilityIds) {
    const receipt = await runtime.invoke(id, value, options);
    receipts.push(receipt.receiptId);
    value = receipt.output;
  }
  return { output: value, receipts };
}
