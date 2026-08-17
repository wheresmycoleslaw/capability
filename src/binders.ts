import { isCapabilityEffect } from "./manifest.js";
import type { CapabilityEffect, JsonValue } from "./types.js";

export const METABOLIC_BINDING_VERSION = "1.0" as const;
export const METABOLIC_EXECUTION_RECEIPT_VERSION = "1.0" as const;

export type BinderDiscoveryMode = "automatic" | "explicit" | "derived";

export type MetabolicAuthority = {
  complete: boolean;
  effects: readonly CapabilityEffect[];
  note?: string;
};

/**
 * Stable 1.x substrate binding envelope.
 *
 * A binding is not merely a locator. It is the point where a generalized
 * substrate adapter commits to the exact artifact it intends to execute and
 * preserves the authority/evidence state that justified the binding.
 */
export type MetabolicBinding = {
  bindingVersion: typeof METABOLIC_BINDING_VERSION;
  binderId: string;
  substrate: string;
  locator: string;
  immutableArtifact: string;
  createdAt: string;
  authority: MetabolicAuthority;
  evidence: readonly string[];
  metadata?: Record<string, JsonValue>;
};

export type BinderExecutionContext = {
  approved?: boolean;
  signal?: AbortSignal;
};

/** Low-level result returned by a binder implementation. */
export type BinderExecutionPayload = {
  status: "succeeded" | "failed";
  output?: JsonValue;
  upstreamReceipt?: JsonValue;
  isolation?: string;
  metadata?: Record<string, JsonValue>;
};

/** Stable 1.x receipt emitted by the registry around every attempted binder execution. */
export type MetabolicExecutionReceipt = {
  receiptVersion: typeof METABOLIC_EXECUTION_RECEIPT_VERSION;
  binderId: string;
  substrate: string;
  locator: string;
  immutableArtifact: string;
  status: "succeeded" | "failed";
  startedAt: string;
  endedAt: string;
  authority: {
    complete: boolean;
    effects: readonly CapabilityEffect[];
  };
  evidence: readonly string[];
  isolation?: string;
  upstreamReceipt?: JsonValue;
  metadata?: Record<string, JsonValue>;
  error?: string;
};

export type BinderExecution = {
  status: "succeeded" | "failed";
  output?: JsonValue;
  receipt: MetabolicExecutionReceipt;
};

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateMetabolicBinding(value: unknown, expected?: Pick<MetabolicBinder<any, any>, "id" | "substrate">): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["binding must be an object"];
  const binding = value as Record<string, unknown>;
  const issues: string[] = [];

  if (binding.bindingVersion !== METABOLIC_BINDING_VERSION) issues.push(`bindingVersion must be ${METABOLIC_BINDING_VERSION}`);
  if (!nonEmpty(binding.binderId)) issues.push("binderId is required");
  if (!nonEmpty(binding.substrate)) issues.push("substrate is required");
  if (!nonEmpty(binding.locator)) issues.push("locator is required");
  if (!nonEmpty(binding.immutableArtifact)) issues.push("immutableArtifact is required; mutable locators are not executable bindings");
  if (!nonEmpty(binding.createdAt) || Number.isNaN(Date.parse(String(binding.createdAt)))) issues.push("createdAt must be an ISO date string");

  if (expected) {
    if (binding.binderId !== expected.id) issues.push(`binderId must match registered binder ${expected.id}`);
    if (binding.substrate !== expected.substrate) issues.push(`substrate must match registered binder substrate ${expected.substrate}`);
  }

  const authority = binding.authority && typeof binding.authority === "object" && !Array.isArray(binding.authority)
    ? binding.authority as Record<string, unknown>
    : undefined;
  if (!authority) issues.push("authority is required");
  else {
    if (typeof authority.complete !== "boolean") issues.push("authority.complete must be boolean");
    if (!Array.isArray(authority.effects)) issues.push("authority.effects must be an array");
    else {
      for (const effect of authority.effects) {
        if (typeof effect !== "string" || !isCapabilityEffect(effect)) issues.push(`invalid authority effect: ${String(effect)}`);
      }
      if (authority.complete === false && !authority.effects.includes("custom:external.opaque-effects")) {
        issues.push("incomplete authority must preserve custom:external.opaque-effects");
      }
    }
    if (authority.note !== undefined && typeof authority.note !== "string") issues.push("authority.note must be a string");
  }

  if (!Array.isArray(binding.evidence) || binding.evidence.length === 0) issues.push("evidence must contain at least one item");
  else if (binding.evidence.some((entry) => !nonEmpty(entry))) issues.push("evidence entries must be non-empty strings");

  if (binding.metadata !== undefined && (!binding.metadata || typeof binding.metadata !== "object" || Array.isArray(binding.metadata))) {
    issues.push("metadata must be an object");
  }

  return issues;
}

export function assertMetabolicBinding(value: unknown, expected?: Pick<MetabolicBinder<any, any>, "id" | "substrate">): asserts value is MetabolicBinding {
  const issues = validateMetabolicBinding(value, expected);
  if (issues.length) throw new TypeError(`Invalid metabolic binding: ${issues.join("; ")}`);
}

/**
 * A binder generalizes adaptation by execution substrate instead of by project.
 *
 * Capability 1.x treats this interface as a public extension contract. A binder
 * MUST bind an immutable artifact before execution and MUST preserve unknown
 * authority rather than guessing it away. The registry validates both rules.
 */
export interface MetabolicBinder<Request = unknown, Binding extends MetabolicBinding = MetabolicBinding> {
  readonly id: string;
  readonly substrate: string;
  readonly discovery: BinderDiscoveryMode;
  readonly description: string;
  bind(request: Request): Promise<Binding>;
  execute?(binding: Binding, input: unknown, context?: BinderExecutionContext): Promise<BinderExecutionPayload>;
}

function validateBinderDefinition(binder: MetabolicBinder<any, any>): void {
  if (!nonEmpty(binder.id)) throw new TypeError("binder.id is required");
  if (!nonEmpty(binder.substrate)) throw new TypeError("binder.substrate is required");
  if (!nonEmpty(binder.description)) throw new TypeError("binder.description is required");
  if (!["automatic", "explicit", "derived"].includes(binder.discovery)) throw new TypeError(`invalid binder.discovery: ${String(binder.discovery)}`);
  if (typeof binder.bind !== "function") throw new TypeError("binder.bind must be a function");
}

export class MetabolicBinderRegistry {
  private readonly binders = new Map<string, MetabolicBinder<any, any>>();

  register<Request, Binding extends MetabolicBinding>(binder: MetabolicBinder<Request, Binding>): this {
    validateBinderDefinition(binder);
    if (this.binders.has(binder.id)) throw new Error(`Binder already registered: ${binder.id}`);
    this.binders.set(binder.id, binder);
    return this;
  }

  get(id: string): MetabolicBinder<any, any> {
    const binder = this.binders.get(id);
    if (!binder) throw new Error(`Unknown metabolic binder: ${id}`);
    return binder;
  }

  forSubstrate(substrate: string): readonly MetabolicBinder<any, any>[] {
    return [...this.binders.values()].filter((binder) => binder.substrate === substrate);
  }

  list(): readonly { id: string; substrate: string; discovery: BinderDiscoveryMode; description: string; executable: boolean }[] {
    return [...this.binders.values()].map((binder) => ({
      id: binder.id,
      substrate: binder.substrate,
      discovery: binder.discovery,
      description: binder.description,
      executable: typeof binder.execute === "function"
    }));
  }

  async bind<Request, Binding extends MetabolicBinding>(id: string, request: Request): Promise<Binding> {
    const binder = this.get(id);
    const binding = await binder.bind(request);
    assertMetabolicBinding(binding, binder);
    return binding as Binding;
  }

  async execute<Binding extends MetabolicBinding>(id: string, binding: Binding, input: unknown, context: BinderExecutionContext = {}): Promise<BinderExecution> {
    const binder = this.get(id);
    assertMetabolicBinding(binding, binder);
    if (!binder.execute) throw new Error(`Binder ${id} does not provide an execution boundary`);
    if (!binding.authority.complete && context.approved !== true) {
      throw new Error(`Binder ${id} requires explicit approval because authority is incomplete`);
    }
    if (context.signal?.aborted) throw context.signal.reason ?? new Error("Binder execution aborted before start");

    const startedAt = new Date().toISOString();
    try {
      const payload = await binder.execute(binding, input, context);
      if (!payload || (payload.status !== "succeeded" && payload.status !== "failed")) {
        throw new TypeError(`Binder ${id} returned an invalid execution status`);
      }
      const receipt: MetabolicExecutionReceipt = {
        receiptVersion: METABOLIC_EXECUTION_RECEIPT_VERSION,
        binderId: binding.binderId,
        substrate: binding.substrate,
        locator: binding.locator,
        immutableArtifact: binding.immutableArtifact,
        status: payload.status,
        startedAt,
        endedAt: new Date().toISOString(),
        authority: { complete: binding.authority.complete, effects: [...binding.authority.effects] },
        evidence: [...binding.evidence],
        ...(payload.isolation ? { isolation: payload.isolation } : {}),
        ...(payload.upstreamReceipt !== undefined ? { upstreamReceipt: payload.upstreamReceipt } : {}),
        ...(payload.metadata ? { metadata: payload.metadata } : {})
      };
      return { status: payload.status, ...(payload.output !== undefined ? { output: payload.output } : {}), receipt };
    } catch (error) {
      return {
        status: "failed",
        receipt: {
          receiptVersion: METABOLIC_EXECUTION_RECEIPT_VERSION,
          binderId: binding.binderId,
          substrate: binding.substrate,
          locator: binding.locator,
          immutableArtifact: binding.immutableArtifact,
          status: "failed",
          startedAt,
          endedAt: new Date().toISOString(),
          authority: { complete: binding.authority.complete, effects: [...binding.authority.effects] },
          evidence: [...binding.evidence],
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
}
