import { fileURLToPath } from "node:url";
import type { Capability, CapabilityContext } from "./types.js";
import { getProvenance } from "./provenance.js";
import { runInNodePermissionSandbox, type NodePermissionSandboxOptions } from "./sandbox.js";

export interface CapabilityExecutor {
  execute(capability: Capability, input: unknown, context: CapabilityContext): unknown | Promise<unknown>;
}

export class InProcessExecutor implements CapabilityExecutor {
  execute(capability: Capability, input: unknown, context: CapabilityContext) { return capability.execute(input, context); }
}

export type SandboxOptionResolver = (capability: Capability, context: CapabilityContext) => Omit<NodePermissionSandboxOptions, "effects">;

export class NodePermissionExecutor implements CapabilityExecutor {
  constructor(private readonly options: SandboxOptionResolver = () => ({})) {}
  async execute(capability: Capability, input: unknown, context: CapabilityContext): Promise<unknown> {
    const provenance = getProvenance(capability);
    if (!provenance?.source) throw new Error(`NodePermissionExecutor requires source provenance for ${capability.manifest.id}`);
    const modulePath = provenance.source.startsWith("file:") ? fileURLToPath(provenance.source) : provenance.source;
    return runInNodePermissionSandbox(modulePath, input, { ...this.options(capability, context), effects: context.plan.effects });
  }
}
