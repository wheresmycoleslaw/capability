import { inspectCapability } from "./define.js";
import { CapabilityRuntime } from "./runtime.js";
import { authorizeEffects, permissivePolicy } from "./policy.js";
import { CapabilityError } from "./errors.js";
import { sha256 } from "./utils.js";
import type { Capability, CapabilityEffect, JsonValue } from "./types.js";
import { createCapabilityGap, metabolizeIntent, type MetabolicSubstrate } from "./metabolism.js";
import { discoverSoftwareWorld, type ExternalSoftwareCandidate, type NativeSoftwareResult } from "./external-discovery.js";
import { assessNativeIntentFit } from "./forge.js";

export type AbilitySourceKind = "native" | "connector" | "mcp" | "openapi" | "npm" | "pypi" | "oci" | "repository" | "composition" | "gap";

export type AbilityCandidate = {
  kind: AbilitySourceKind;
  id: string;
  name?: string;
  description?: string;
  ready: boolean;
  trusted?: boolean;
  score?: number;
  effects?: readonly CapabilityEffect[];
  authorityComplete?: boolean;
  /** Whether the selected ability can execute immediately without a materialization/acquisition step. */
  executionReady?: boolean;
  metadata?: Record<string, JsonValue>;
};

export type AbilityProviderContext = {
  intent: string;
  input?: unknown;
  approved?: boolean;
};

export interface AbilityProvider {
  readonly id: string;
  readonly kind: AbilitySourceKind;
  readonly priority: number;
  readonly description: string;
  discover(context: AbilityProviderContext): Promise<readonly AbilityCandidate[]>;
  execute?(candidate: AbilityCandidate, context: AbilityProviderContext): Promise<unknown>;
  close?(): void | Promise<void>;
}

export type PreparedProviderReceipt = {
  receiptVersion: "0.1";
  provider: { id: string; kind: AbilitySourceKind };
  ability: { id: string; name?: string };
  status: "succeeded";
  effects: readonly CapabilityEffect[];
  authorityComplete: boolean;
  approved: boolean;
  inputHash: string;
  outputHash: string;
  startedAt: string;
  endedAt: string;
  upstreamReceipt?: unknown;
};

export type NeedResolution = {
  intent: string;
  status: "ready" | "executed" | "unresolved";
  provider?: string;
  source?: AbilitySourceKind;
  candidate?: AbilityCandidate;
  result?: unknown;
  receipt?: unknown;
  considered: { provider: string; kind: AbilitySourceKind; candidates: number; detail?: string }[];
};

export class AbilityProviderRegistry {
  private readonly providers = new Map<string, AbilityProvider>();

  register(provider: AbilityProvider): this {
    if (!provider.id.trim()) throw new TypeError("provider.id is required");
    if (!provider.description.trim()) throw new TypeError("provider.description is required");
    if (!Number.isFinite(provider.priority)) throw new TypeError("provider.priority must be finite");
    if (this.providers.has(provider.id)) throw new Error(`Ability provider already registered: ${provider.id}`);
    this.providers.set(provider.id, provider);
    return this;
  }

  list(): readonly AbilityProvider[] {
    return [...this.providers.values()].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.list().map((provider) => provider.close?.()));
  }
}

export type NeedOptions = Omit<AbilityProviderContext, "intent"> & {
  providers?: AbilityProviderRegistry;
  execute?: boolean;
  indexes?: readonly string[];
  pythonPackage?: string;
  pythonVersion?: string;
  ociImage?: string;
  ociArgs?: string[];
  externalOnly?: boolean;
  allowUnverifiedSource?: boolean;
  fetch?: typeof fetch;
  githubToken?: string;
};

const NEED_STOPWORDS = new Set(["a", "an", "the", "to", "of", "for", "in", "on", "at", "by", "with", "and", "or", "from", "into", "this", "that", "my", "your", "its", "please", "use", "using", "need", "needs", "ability", "abilities", "tool", "tools"]);
function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length > 1 && !NEED_STOPWORDS.has(part));
}

function lexicalScore(intent: string, capability: Capability): number {
  const manifest = inspectCapability(capability);
  const intentTokens = new Set(tokens(intent));
  if (!intentTokens.size) return 0;
  const fields = [manifest.id, manifest.name, manifest.description, ...(manifest.tags ?? [])].join(" ").toLowerCase();
  let hits = 0;
  for (const token of intentTokens) if (fields.includes(token)) hits += 1;
  return hits / intentTokens.size;
}

function providerEffects(candidate: AbilityCandidate): CapabilityEffect[] {
  const effects: CapabilityEffect[] = [...(candidate.effects ?? [])];
  if (candidate.authorityComplete !== true) effects.push("custom:provider.opaque-effects");
  return [...new Set(effects)];
}

function authorizeProviderCandidate(candidate: AbilityCandidate, approved: boolean): CapabilityEffect[] {
  const effects = providerEffects(candidate);
  const decision = authorizeEffects(effects, permissivePolicy, approved);
  if (decision.allowed) return effects;
  const code = decision.approvalRequired.length ? "APPROVAL_REQUIRED" : "PERMISSION_DENIED";
  throw new CapabilityError(code, decision.reason ?? `Provider ability ${candidate.id} is not authorized`, {
    candidate: candidate.id,
    effects,
    decision
  });
}

/**
 * Turn an already-prepared set of capabilities into a preferred provider.
 *
 * This is the bridge used by MCP, OpenAPI, managed connectors, native packages,
 * and application-specific catalogs. It deliberately reuses CapabilityRuntime so
 * prepared integrations receive the same authorization and receipt semantics as
 * acquired software.
 */
export function providerFromCapabilities(options: {
  id: string;
  kind: Exclude<AbilitySourceKind, "gap">;
  priority?: number;
  description: string;
  capabilities: readonly Capability<any, any>[];
  trusted?: boolean;
}): AbilityProvider {
  const byId = new Map(options.capabilities.map((capability) => [capability.manifest.id, capability]));
  return {
    id: options.id,
    kind: options.kind,
    priority: options.priority ?? 20,
    description: options.description,
    async discover({ intent }) {
      return [...byId.values()]
        .map((capability) => {
          const manifest = inspectCapability(capability);
          return {
            kind: options.kind,
            id: manifest.id,
            name: manifest.name,
            description: manifest.description,
            ready: true,
            trusted: options.trusted ?? false,
            score: lexicalScore(intent, capability),
            effects: manifest.effects ?? [],
            authorityComplete: true,
            executionReady: true,
            metadata: { version: manifest.version }
          } satisfies AbilityCandidate;
        })
        .filter((candidate) => (candidate.score ?? 0) >= 0.6)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    },
    async execute(candidate, context) {
      const capability = byId.get(candidate.id);
      if (!capability) throw new Error(`Capability ${candidate.id} is no longer available from provider ${options.id}`);
      const runtime = new CapabilityRuntime({ policy: permissivePolicy }).register(capability);
      const input = context.input === undefined ? {} : context.input;
      const receipt = await runtime.invoke(candidate.id, input, { approved: context.approved ?? false });
      return { output: receipt.output, receipt };
    }
  };
}

function indexedAbilityCandidate(entry: NativeSoftwareResult): AbilityCandidate {
  return {
    kind: "native",
    id: entry.id,
    name: entry.name,
    description: entry.description,
    ready: true,
    executionReady: true,
    trusted: true,
    score: entry.score,
    effects: [...entry.effects] as CapabilityEffect[],
    authorityComplete: true,
    metadata: { package: entry.package, stage: "indexed", reasons: [...entry.reasons] }
  };
}

function externalAbilityCandidate(entry: ExternalSoftwareCandidate): AbilityCandidate {
  return {
    kind: entry.source === "npm" ? "npm" : "repository",
    id: entry.locator,
    name: entry.name,
    description: entry.description,
    ready: true,
    executionReady: false,
    trusted: false,
    score: entry.score,
    effects: ["custom:external.opaque-effects"],
    authorityComplete: false,
    metadata: {
      stage: "discovered",
      source: entry.source,
      locator: entry.locator,
      sourceRank: entry.sourceRank,
      signals: [...entry.signals],
      adoption: entry.adoption.map((hint) => ({ method: hint.method, confidence: hint.confidence, reason: hint.reason })),
      ...(entry.version ? { version: entry.version } : {}),
      ...(entry.repository ? { repository: entry.repository } : {}),
      ...(entry.homepage ? { homepage: entry.homepage } : {}),
      ...(entry.language ? { language: entry.language } : {}),
      ...(entry.license ? { license: entry.license } : {}),
      ...(entry.popularity !== undefined ? { popularity: entry.popularity } : {})
    }
  };
}

/**
 * Resolve an intent through the simplest production-ready provider first.
 *
 * Prepared providers are always consulted before Capability attempts package,
 * container, or repository acquisition. The caller asks for an ability; substrate
 * selection is an implementation detail unless diagnostics are requested.
 */
export async function need(intent: string, options: NeedOptions = {}): Promise<NeedResolution> {
  if (!intent.trim()) throw new TypeError("intent is required");
  const context: AbilityProviderContext = {
    intent,
    ...(options.input !== undefined ? { input: options.input } : {}),
    ...(options.approved !== undefined ? { approved: options.approved } : {})
  };
  const considered: NeedResolution["considered"] = [];

  for (const provider of options.providers?.list() ?? []) {
    let candidates: readonly AbilityCandidate[];
    try {
      candidates = await provider.discover(context);
    } catch (error) {
      considered.push({ provider: provider.id, kind: provider.kind, candidates: 0, detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const ready = [...candidates]
      .filter((candidate) => candidate.ready)
      .sort((a, b) => Number(Boolean(b.trusted)) - Number(Boolean(a.trusted)) || (b.score ?? 0) - (a.score ?? 0))[0];
    considered.push({ provider: provider.id, kind: provider.kind, candidates: candidates.length });
    if (!ready) continue;
    if (options.execute) {
      if (!provider.execute) {
        considered[considered.length - 1] = {
          provider: provider.id,
          kind: provider.kind,
          candidates: candidates.length,
          detail: "selected candidate is not executable by this provider; continuing resolution"
        };
        continue;
      }
      const approved = options.approved ?? false;
      const effects = authorizeProviderCandidate(ready, approved);
      const startedAt = new Date().toISOString();
      const result = await provider.execute(ready, context);
      const endedAt = new Date().toISOString();
      const record = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : undefined;
      const output = record?.output ?? result;
      const receipt: PreparedProviderReceipt = {
        receiptVersion: "0.1",
        provider: { id: provider.id, kind: provider.kind },
        ability: { id: ready.id, ...(ready.name ? { name: ready.name } : {}) },
        status: "succeeded",
        effects,
        authorityComplete: ready.authorityComplete === true,
        approved,
        inputHash: sha256(context.input === undefined ? {} : context.input),
        outputHash: sha256(output),
        startedAt,
        endedAt,
        ...(record?.receipt !== undefined ? { upstreamReceipt: record.receipt } : {})
      };
      return {
        intent,
        status: "executed",
        provider: provider.id,
        source: provider.kind,
        candidate: ready,
        result: output,
        receipt,
        considered
      };
    }
    return { intent, status: "ready", provider: provider.id, source: provider.kind, candidate: ready, considered };
  }

  // A non-executing need is a resolution request, not permission to build arbitrary software.
  // Search the whole software world first and return the best honest candidate without forcing Forge.
  if (!options.execute) {
    try {
      const discovery = await discoverSoftwareWorld(intent, {
        ...(options.indexes ? { indexes: options.indexes } : {}),
        includeNative: options.externalOnly !== true,
        includeExternal: true,
        limit: 12,
        ...(options.fetch ? { fetch: options.fetch } : {}),
        ...(options.githubToken ? { githubToken: options.githubToken } : {})
      });

      if (options.externalOnly !== true) {
        considered.push({ provider: "capability/index", kind: "native", candidates: discovery.native.length });
        const native = discovery.native
          .map((candidate) => ({ candidate, fit: assessNativeIntentFit(intent, candidate) }))
          .find((entry) => entry.fit.accepted);
        if (native) {
          return {
            intent,
            status: "ready",
            provider: "capability/index",
            source: "native",
            candidate: indexedAbilityCandidate(native.candidate),
            considered
          };
        }
      }

      const npm = discovery.external.filter((candidate) => candidate.source === "npm");
      const repositories = discovery.external.filter((candidate) => candidate.source === "github");
      considered.push({ provider: "capability/npm", kind: "npm", candidates: npm.length });
      considered.push({ provider: "capability/github", kind: "repository", candidates: repositories.length });
      const external = discovery.external[0];
      if (external) {
        const candidate = externalAbilityCandidate(external);
        return {
          intent,
          status: "ready",
          provider: "capability/software-world",
          source: candidate.kind,
          candidate,
          result: {
            stage: "discovered",
            executionReady: false,
            candidate,
            errors: discovery.errors
          },
          considered
        };
      }
      if (discovery.errors.length) {
        considered.push({
          provider: "capability/discovery",
          kind: "gap",
          candidates: 0,
          detail: discovery.errors.map((error) => `${error.source}: ${error.message}`).join(" | ")
        });
      }
    } catch (error) {
      considered.push({ provider: "capability/discovery", kind: "gap", candidates: 0, detail: error instanceof Error ? error.message : String(error) });
    }
  }

  const fallback = await metabolizeIntent(intent, {
    ...(options.execute && options.input !== undefined ? { input: options.input } : {}),
    ...(options.approved !== undefined ? { approved: options.approved } : {}),
    ...(options.indexes ? { indexes: options.indexes } : {}),
    ...(options.pythonPackage ? { pythonPackage: options.pythonPackage } : {}),
    ...(options.pythonVersion ? { pythonVersion: options.pythonVersion } : {}),
    ...(options.execute && options.ociImage ? { ociImage: options.ociImage } : {}),
    ...(options.execute && options.ociArgs ? { ociArgs: options.ociArgs } : {}),
    ...(options.externalOnly !== undefined ? { externalOnly: options.externalOnly } : {}),
    ...(options.allowUnverifiedSource !== undefined ? { allowUnverifiedSource: options.allowUnverifiedSource } : {})
  });

  const fallbackKind: AbilitySourceKind = fallback.route as MetabolicSubstrate;
  considered.push({ provider: "capability/software-world", kind: fallbackKind, candidates: fallback.route === "gap" ? 0 : 1 });
  if (fallback.route === "gap") {
    return {
      intent,
      status: "unresolved",
      source: "gap",
      result: fallback.gap ?? createCapabilityGap(intent),
      considered
    };
  }
  return {
    intent,
    status: fallback.receipt ? "executed" : "ready",
    provider: "capability/software-world",
    source: fallbackKind,
    result: fallback.result,
    receipt: fallback.receipt,
    considered
  };
}

/** Convenience helper for prepared integrations discovered outside Capability core. */
export function defineAbilityProvider(provider: AbilityProvider): AbilityProvider {
  return provider;
}
