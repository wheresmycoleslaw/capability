import { fileURLToPath } from "node:url";
import type {
  Capability,
  CapabilityContext,
  CapabilityPlanDetails,
  CapabilityVerification,
  RollbackContext
} from "./types.js";
import { getProvenance } from "./provenance.js";
import { runNodeCapabilityLifecycle, type NodePermissionSandboxOptions } from "./sandbox.js";

export interface CapabilityExecutor {
  execute(capability: Capability, input: unknown, context: CapabilityContext): unknown | Promise<unknown>;
  plan?(capability: Capability, input: unknown): CapabilityPlanDetails | Promise<CapabilityPlanDetails>;
  verify?(capability: Capability, output: unknown, context: CapabilityContext): boolean | CapabilityVerification | undefined | Promise<boolean | CapabilityVerification | undefined>;
  rollback?(capability: Capability, context: RollbackContext<unknown, unknown>): unknown | Promise<unknown>;
}

export class InProcessExecutor implements CapabilityExecutor {
  execute(capability: Capability, input: unknown, context: CapabilityContext) { return capability.execute(input, context); }
  async plan(capability: Capability, input: unknown) { return capability.plan ? await capability.plan(input) : {}; }
  async verify(capability: Capability, output: unknown, context: CapabilityContext) { return capability.verify ? await capability.verify(output, context) : undefined; }
  async rollback(capability: Capability, context: RollbackContext<unknown, unknown>) {
    if (!capability.rollback) throw new Error(`Capability does not provide rollback(): ${capability.manifest.id}`);
    return capability.rollback(context);
  }
}

export type SandboxOptionResolver = (capability: Capability, context?: CapabilityContext) => Omit<NodePermissionSandboxOptions, "effects" | "context">;

export class NodePermissionExecutor implements CapabilityExecutor {
  constructor(private readonly options: SandboxOptionResolver = () => ({})) {}

  private module(capability: Capability): { path: string; allowRead: string[] } {
    const provenance = getProvenance(capability);
    if (!provenance?.source) throw new Error(`NodePermissionExecutor requires source provenance for ${capability.manifest.id}`);
    const path = provenance.source.startsWith("file:") ? fileURLToPath(provenance.source) : provenance.source;
    return { path, allowRead: provenance.packageRoot ? [provenance.packageRoot] : [] };
  }

  private sandboxOptions(capability: Capability, context: CapabilityContext | undefined, effects = capability.manifest.effects ?? []) {
    const configured = this.options(capability, context);
    const source = this.module(capability);
    return {
      ...configured,
      allowRead: [...new Set([...source.allowRead, ...(configured.allowRead ?? [])])],
      effects,
      ...(context ? { context } : {})
    };
  }

  async execute(capability: Capability, input: unknown, context: CapabilityContext): Promise<unknown> {
    const source = this.module(capability);
    const response = await runNodeCapabilityLifecycle(source.path, { action: "execute", input, manifest: context.manifest, plan: context.plan }, this.sandboxOptions(capability, context, context.plan.effects));
    return response.result;
  }

  async plan(capability: Capability, input: unknown): Promise<CapabilityPlanDetails> {
    const source = this.module(capability);
    const response = await runNodeCapabilityLifecycle(source.path, { action: "plan", input, manifest: capability.manifest }, this.sandboxOptions(capability, undefined));
    return (response.result ?? {}) as CapabilityPlanDetails;
  }

  async verify(capability: Capability, output: unknown, context: CapabilityContext): Promise<boolean | CapabilityVerification | undefined> {
    const source = this.module(capability);
    const response = await runNodeCapabilityLifecycle(source.path, { action: "verify", output, manifest: context.manifest, plan: context.plan }, this.sandboxOptions(capability, context, context.plan.effects));
    return response.hasResult ? response.result as boolean | CapabilityVerification : undefined;
  }

  async rollback(capability: Capability, context: RollbackContext<unknown, unknown>): Promise<unknown> {
    const source = this.module(capability);
    const response = await runNodeCapabilityLifecycle(source.path, {
      action: "rollback",
      input: context.input,
      output: context.output,
      receipt: context.receipt,
      manifest: context.manifest,
      plan: context.plan
    }, this.sandboxOptions(capability, context, context.plan.effects));
    return response.result;
  }
}
