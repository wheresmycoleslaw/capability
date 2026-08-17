import type { CapabilityEffect, JsonValue } from "./types.js";

export type BinderDiscoveryMode = "automatic" | "explicit" | "derived";

export type MetabolicBinding = {
  binderId: string;
  substrate: string;
  locator: string;
  immutableArtifact?: string;
  authority: {
    complete: boolean;
    effects: readonly CapabilityEffect[];
    note?: string;
  };
  evidence: readonly string[];
  metadata?: Record<string, JsonValue>;
};

export type BinderExecutionContext = {
  approved?: boolean;
  signal?: AbortSignal;
};

export type BinderExecution = {
  status: "succeeded" | "failed";
  output?: JsonValue;
  receipt: JsonValue;
};

/**
 * A binder generalizes adaptation by execution substrate instead of by project.
 * Implementations are expected to bind an exact artifact before execution and
 * to preserve unknown authority rather than guessing it away.
 */
export interface MetabolicBinder<Request = unknown, Binding extends MetabolicBinding = MetabolicBinding> {
  readonly id: string;
  readonly substrate: string;
  readonly discovery: BinderDiscoveryMode;
  readonly description: string;
  bind(request: Request): Promise<Binding>;
  execute?(binding: Binding, input: unknown, context?: BinderExecutionContext): Promise<BinderExecution>;
}

export class MetabolicBinderRegistry {
  private readonly binders = new Map<string, MetabolicBinder<any, any>>();

  register<Request, Binding extends MetabolicBinding>(binder: MetabolicBinder<Request, Binding>): this {
    if (!binder.id.trim()) throw new TypeError("binder.id is required");
    if (!binder.substrate.trim()) throw new TypeError("binder.substrate is required");
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
    return this.get(id).bind(request) as Promise<Binding>;
  }

  async execute<Binding extends MetabolicBinding>(id: string, binding: Binding, input: unknown, context: BinderExecutionContext = {}): Promise<BinderExecution> {
    const binder = this.get(id);
    if (!binder.execute) throw new Error(`Binder ${id} does not provide an execution boundary`);
    return binder.execute(binding, input, context);
  }
}
