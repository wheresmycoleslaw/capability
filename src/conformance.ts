import {
  METABOLIC_BINDING_VERSION,
  METABOLIC_EXECUTION_RECEIPT_VERSION,
  MetabolicBinderRegistry,
  validateMetabolicBinding,
  type MetabolicBinder,
  type MetabolicBinding
} from "./binders.js";
import { validateManifest } from "./manifest.js";
import { CAPABILITY_PROTOCOL_VERSION, capabilityProtocolInfo } from "./protocol.js";
import { createCapabilityIndex, validateCapabilityIndex } from "./public-index.js";
import type { CapabilityManifest, JsonValue } from "./types.js";
import { createCapabilitySiteDocument, validateCapabilitySiteDocument } from "./web-discovery.js";

export type ConformanceCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type ConformanceReport = {
  protocolVersion: typeof CAPABILITY_PROTOCOL_VERSION;
  ok: boolean;
  checks: readonly ConformanceCheck[];
};

async function check(id: string, fn: () => void | Promise<void>): Promise<ConformanceCheck> {
  try {
    await fn();
    return { id, ok: true, message: "pass" };
  } catch (error) {
    return { id, ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function canonicalManifest(): CapabilityManifest {
  return {
    specVersion: "0.1",
    id: "conformance/echo",
    version: "1.0.0",
    name: "Conformance Echo",
    description: "Reference inert contract used by the Capability 1.x conformance suite.",
    input: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    output: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    tags: ["conformance"]
  };
}

function referenceBinder(): MetabolicBinder<{ locator: string }> {
  return {
    id: "conformance/memory",
    substrate: "memory",
    discovery: "explicit",
    description: "In-memory reference binder used only to verify the stable 1.x extension boundary.",
    async bind(request) {
      return {
        bindingVersion: METABOLIC_BINDING_VERSION,
        binderId: this.id,
        substrate: this.substrate,
        locator: request.locator,
        immutableArtifact: "sha256:8a6f1b2f587e6aa5a8b8f2d036f9b15519ed0afcdd851c4a62dde3ca55c9748e",
        createdAt: new Date().toISOString(),
        authority: {
          complete: false,
          effects: ["custom:external.opaque-effects"],
          note: "The conformance binder deliberately preserves unknown authority."
        },
        evidence: ["conformance:reference-artifact"]
      };
    },
    async execute(_binding, input) {
      return {
        status: "succeeded",
        output: JSON.parse(JSON.stringify(input ?? null)) as JsonValue,
        upstreamReceipt: { reference: "conformance" },
        isolation: "in-memory-test-boundary"
      };
    }
  };
}

/**
 * Run the reference Capability 1.x protocol checks without network access or
 * third-party code. This suite verifies the contracts we promise to keep
 * stable; ecosystem/security evaluation remains a separate concern.
 */
export async function runProtocolConformance(): Promise<ConformanceReport> {
  const checks: ConformanceCheck[] = [];
  const manifest = canonicalManifest();

  checks.push(await check("protocol-info", () => {
    const info = capabilityProtocolInfo();
    if (info.protocolVersion !== "1.0" || info.stabilityLine !== "1.x") throw new Error("protocol stability line is not 1.x");
    if (info.formats.metabolicBinding !== "1.0" || info.formats.metabolicExecutionReceipt !== "1.0") throw new Error("stable metabolic envelopes are not version 1.0");
  }));

  checks.push(await check("manifest", () => {
    const issues = validateManifest(manifest);
    if (issues.length) throw new Error(issues.join("; "));
  }));

  checks.push(await check("index", () => {
    const document = createCapabilityIndex([{
      name: "@conformance/reference",
      version: "1.0.0",
      source: "conformance",
      capabilities: [{ manifest, module: "./dist/index.js" }]
    }], new Date("2026-01-01T00:00:00.000Z"));
    const issues = validateCapabilityIndex(document);
    if (issues.length) throw new Error(issues.join("; "));
  }));

  checks.push(await check("site-discovery", () => {
    const document = createCapabilitySiteDocument({ indexes: ["https://example.invalid/capability-index.json"] });
    const issues = validateCapabilitySiteDocument(document);
    if (issues.length) throw new Error(issues.join("; "));
  }));

  const registry = new MetabolicBinderRegistry().register(referenceBinder());
  let binding: MetabolicBinding | undefined;

  checks.push(await check("immutable-binding", async () => {
    binding = await registry.bind("conformance/memory", { locator: "memory://reference" });
    const issues = validateMetabolicBinding(binding, registry.get("conformance/memory"));
    if (issues.length) throw new Error(issues.join("; "));
    if (!binding.immutableArtifact.startsWith("sha256:")) throw new Error("reference binding is not content-addressed");
  }));

  checks.push(await check("approval-gate", async () => {
    const bound = binding ?? await registry.bind("conformance/memory", { locator: "memory://reference" });
    let refused = false;
    try { await registry.execute("conformance/memory", bound, { value: "blocked" }); }
    catch (error) { refused = /explicit approval/.test(error instanceof Error ? error.message : String(error)); }
    if (!refused) throw new Error("incomplete authority was executable without explicit approval");
  }));

  checks.push(await check("standard-receipt", async () => {
    const bound = binding ?? await registry.bind("conformance/memory", { locator: "memory://reference" });
    const execution = await registry.execute("conformance/memory", bound, { value: "ok" }, { approved: true });
    if (execution.status !== "succeeded") throw new Error("reference binder execution failed");
    if (execution.receipt.receiptVersion !== METABOLIC_EXECUTION_RECEIPT_VERSION) throw new Error("receipt version mismatch");
    if (execution.receipt.immutableArtifact !== bound.immutableArtifact) throw new Error("receipt lost immutable artifact identity");
    if (execution.receipt.authority.complete !== false) throw new Error("receipt lost authority incompleteness");
    if (!execution.receipt.evidence.includes("conformance:reference-artifact")) throw new Error("receipt lost binding evidence");
  }));

  return { protocolVersion: CAPABILITY_PROTOCOL_VERSION, ok: checks.every((entry) => entry.ok), checks };
}

export async function assertProtocolConformance(): Promise<void> {
  const report = await runProtocolConformance();
  const failures = report.checks.filter((entry) => !entry.ok);
  if (failures.length) throw new Error(`Capability 1.x conformance failed: ${failures.map((entry) => `${entry.id}: ${entry.message}`).join("; ")}`);
}

/**
 * Exercise a third-party binder through the same registry boundary used by the
 * reference runtime. Project-specific success is not conformance: the binder
 * must produce a valid exact binding first.
 */
export async function runBinderConformance<Request, Binding extends MetabolicBinding>(
  binder: MetabolicBinder<Request, Binding>,
  request: Request,
  options: { executeInput?: unknown; approved?: boolean } = {}
): Promise<ConformanceReport> {
  const checks: ConformanceCheck[] = [];
  const registry = new MetabolicBinderRegistry().register(binder);
  let binding: Binding | undefined;

  checks.push(await check("binder-registration", () => {
    const registered = registry.get(binder.id);
    if (registered.substrate !== binder.substrate) throw new Error("registered substrate changed");
  }));

  checks.push(await check("binder-binding", async () => {
    binding = await registry.bind<Request, Binding>(binder.id, request);
    const issues = validateMetabolicBinding(binding, binder);
    if (issues.length) throw new Error(issues.join("; "));
  }));

  if (options.executeInput !== undefined) {
    checks.push(await check("binder-execution", async () => {
      const bound = binding ?? await registry.bind<Request, Binding>(binder.id, request);
      const execution = await registry.execute(binder.id, bound, options.executeInput, { approved: options.approved === true });
      if (execution.receipt.immutableArtifact !== bound.immutableArtifact) throw new Error("execution receipt is not bound to the selected artifact");
      if (execution.receipt.binderId !== binder.id || execution.receipt.substrate !== binder.substrate) throw new Error("execution receipt changed binder identity");
    }));
  }

  return { protocolVersion: CAPABILITY_PROTOCOL_VERSION, ok: checks.every((entry) => entry.ok), checks };
}
