import { CapabilityError, asSerializedError } from "./errors.js";
import { inspectCapability } from "./define.js";
import { authorizeEffects, denyAllPolicy } from "./policy.js";
import { CapabilityRegistry } from "./registry.js";
import { MemoryReceiptStore, type ReceiptStore } from "./receipts.js";
import { validateValue } from "./schema.js";
import { getProvenance } from "./provenance.js";
import { InProcessExecutor, type CapabilityExecutor } from "./executor.js";
import type {
  AuthorizationDecision,
  Capability,
  CapabilityEffect,
  CapabilityPlan,
  CapabilityPolicy,
  CapabilityReceipt,
  CapabilityVerification,
  DiscoveryQuery,
  ExecutionOptions,
  RollbackContext
} from "./types.js";
import { deepFreeze, makeId, sha256, unique } from "./utils.js";

export type CapabilityRuntimeOptions = {
  registry?: CapabilityRegistry;
  receipts?: ReceiptStore;
  policy?: CapabilityPolicy;
  clock?: () => Date;
  executor?: CapabilityExecutor;
};

function planFingerprint(plan: Omit<CapabilityPlan, "fingerprint">): string { return sha256(plan); }
function normalizeVerification(value: boolean | CapabilityVerification): CapabilityVerification { return typeof value === "boolean" ? { ok: value } : value; }
function assertPlannedEffectsDeclared(planned: readonly CapabilityEffect[], declared: readonly CapabilityEffect[]): void {
  const undeclared = planned.filter((effect) => !declared.includes(effect));
  if (undeclared.length) throw new CapabilityError("INVALID_PLAN", `Plan requested undeclared effects: ${undeclared.join(", ")}`);
}

export class CapabilityRuntime {
  readonly registry: CapabilityRegistry;
  readonly receipts: ReceiptStore;
  readonly policy: CapabilityPolicy;
  private readonly clock: () => Date;
  private readonly executor: CapabilityExecutor;

  constructor(options: CapabilityRuntimeOptions = {}) {
    this.registry = options.registry ?? new CapabilityRegistry();
    this.receipts = options.receipts ?? new MemoryReceiptStore();
    this.policy = options.policy ?? denyAllPolicy;
    this.clock = options.clock ?? (() => new Date());
    this.executor = options.executor ?? new InProcessExecutor();
  }

  register(capability: Capability): this { this.registry.register(capability); return this; }
  inspect(id: string) { return inspectCapability(this.registry.require(id)); }
  discover(query: DiscoveryQuery | string) { return this.registry.discover(query); }

  async plan(id: string, input: unknown): Promise<CapabilityPlan> {
    const capability = this.registry.require(id);
    const inputIssues = validateValue(capability.manifest.input, input);
    if (inputIssues.length) throw new CapabilityError("INVALID_INPUT", "Input failed schema validation", inputIssues);
    const declared = capability.manifest.effects ?? [];
    const details = capability.plan
      ? await capability.plan(input)
      : this.executor.plan
        ? await this.executor.plan(capability, input)
        : {};
    const effects = unique(details.effects ?? declared);
    assertPlannedEffectsDeclared(effects, declared);
    const base: Omit<CapabilityPlan, "fingerprint"> = {
      planId: makeId("plan"),
      capability: { id: capability.manifest.id, version: capability.manifest.version },
      input,
      inputHash: sha256(input),
      effects,
      summary: details.summary ?? `Execute ${capability.manifest.name}`,
      createdAt: this.clock().toISOString(),
      ...(details.data !== undefined ? { data: details.data } : {})
    };
    return deepFreeze({ ...base, fingerprint: planFingerprint(base) }) as CapabilityPlan;
  }

  authorize(plan: CapabilityPlan, approved = false): AuthorizationDecision {
    this.assertPlanIntegrity(plan);
    return authorizeEffects(plan.effects, this.policy, approved);
  }

  async invoke(id: string, input: unknown, options: ExecutionOptions = {}): Promise<CapabilityReceipt> { return this.execute(await this.plan(id, input), options); }

  async execute(plan: CapabilityPlan, options: ExecutionOptions = {}): Promise<CapabilityReceipt> {
    this.assertPlanIntegrity(plan);
    const capability = this.registry.require(plan.capability.id);
    if (capability.manifest.version !== plan.capability.version) throw new CapabilityError("INVALID_PLAN", "Capability version changed after planning");
    const decision = this.authorize(plan, options.approved ?? false);
    if (!decision.allowed) {
      const code = decision.approvalRequired.length ? "APPROVAL_REQUIRED" : "PERMISSION_DENIED";
      throw new CapabilityError(code, decision.reason ?? code, decision);
    }

    const started = this.clock();
    const receiptId = makeId("receipt");
    const context = { manifest: capability.manifest, plan, signal: options.signal };
    try {
      const output = await this.executor.execute(capability, plan.input, context);
      const outputIssues = validateValue(capability.manifest.output, output);
      if (outputIssues.length) throw new CapabilityError("INVALID_OUTPUT", "Output failed schema validation", outputIssues);
      const verificationResult = capability.verify
        ? await capability.verify(output, context)
        : this.executor.verify
          ? await this.executor.verify(capability, output, context)
          : undefined;
      let verification: CapabilityVerification | undefined;
      if (verificationResult !== undefined) {
        verification = normalizeVerification(verificationResult);
        if (!verification.ok) throw new CapabilityError("VERIFY_FAILED", verification.message ?? "Capability verification failed", verification);
      }
      const ended = this.clock();
      const receipt: CapabilityReceipt = deepFreeze({
        receiptId, planId: plan.planId, capability: plan.capability, status: "succeeded",
        startedAt: started.toISOString(), endedAt: ended.toISOString(), durationMs: Math.max(0, ended.getTime() - started.getTime()),
        effects: plan.effects, inputHash: plan.inputHash, outputHash: sha256(output), input: plan.input, output,
        ...(verification ? { verification } : {}),
        ...(options.metadata ? { metadata: options.metadata } : {}),
        ...(getProvenance(capability) ? { provenance: getProvenance(capability) } : {})
      });
      await this.receipts.put(receipt);
      return receipt;
    } catch (error) {
      const ended = this.clock();
      const receipt: CapabilityReceipt = deepFreeze({
        receiptId, planId: plan.planId, capability: plan.capability, status: "failed",
        startedAt: started.toISOString(), endedAt: ended.toISOString(), durationMs: Math.max(0, ended.getTime() - started.getTime()),
        effects: plan.effects, inputHash: plan.inputHash, input: plan.input, error: asSerializedError(error),
        ...(options.metadata ? { metadata: options.metadata } : {}),
        ...(getProvenance(capability) ? { provenance: getProvenance(capability) } : {})
      });
      await this.receipts.put(receipt);
      if (error instanceof CapabilityError) throw error;
      throw new CapabilityError("EXECUTION_FAILED", `Capability execution failed; receipt ${receiptId}`, { receiptId, cause: error });
    }
  }

  async rollback(receiptId: string, options: ExecutionOptions = {}): Promise<CapabilityReceipt> {
    const original = await this.receipts.get(receiptId);
    if (!original) throw new CapabilityError("NOT_FOUND", `Receipt not found: ${receiptId}`);
    if (original.status !== "succeeded") throw new CapabilityError("ROLLBACK_UNAVAILABLE", "Only successful executions can be rolled back");
    const capability = this.registry.require(original.capability.id);
    if (capability.manifest.behavior?.reversible !== true || (!capability.rollback && !this.executor.rollback)) {
      throw new CapabilityError("ROLLBACK_UNAVAILABLE", `Capability is not rollback-enabled: ${capability.manifest.id}`);
    }
    const decision = authorizeEffects(original.effects, this.policy, options.approved ?? false);
    if (!decision.allowed) {
      const code = decision.approvalRequired.length ? "APPROVAL_REQUIRED" : "PERMISSION_DENIED";
      throw new CapabilityError(code, decision.reason ?? code, decision);
    }
    const plan: CapabilityPlan = deepFreeze({
      planId: original.planId, capability: original.capability, input: original.input, inputHash: original.inputHash,
      effects: original.effects, summary: `Rollback ${capability.manifest.name}`, createdAt: this.clock().toISOString(), fingerprint: "rollback"
    });
    const context = {
      manifest: capability.manifest, plan, signal: options.signal, input: original.input, output: original.output, receipt: original
    } as RollbackContext<unknown, unknown>;
    try {
      const rollbackResult = capability.rollback ? await capability.rollback(context as never) : await this.executor.rollback!(capability, context);
      const ended = this.clock();
      const updated: CapabilityReceipt = deepFreeze({ ...original, status: "rolled_back", endedAt: ended.toISOString(), rollbackResult });
      await this.receipts.put(updated);
      return updated;
    } catch (error) {
      const updated: CapabilityReceipt = deepFreeze({ ...original, status: "rollback_failed", endedAt: this.clock().toISOString(), error: asSerializedError(error) });
      await this.receipts.put(updated);
      throw new CapabilityError("ROLLBACK_FAILED", `Rollback failed for receipt ${receiptId}`, { receiptId, cause: error });
    }
  }

  async getReceipt(receiptId: string): Promise<CapabilityReceipt | undefined> { return this.receipts.get(receiptId); }
  async listReceipts(): Promise<CapabilityReceipt[]> { return this.receipts.list(); }

  private assertPlanIntegrity(plan: CapabilityPlan): void {
    if (plan.fingerprint === "rollback") return;
    const { fingerprint, ...base } = plan;
    if (planFingerprint(base) !== fingerprint) throw new CapabilityError("INVALID_PLAN", "Plan fingerprint mismatch");
    if (sha256(plan.input) !== plan.inputHash) throw new CapabilityError("INVALID_PLAN", "Plan input hash mismatch");
  }
}
