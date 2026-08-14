import type { CapabilityEffect, CapabilityManifest, CapabilityReceipt, JsonSchema } from "./types.js";

const OPEN_WORLD = new Set<CapabilityEffect>([
  "filesystem.write", "network.connect", "process.spawn", "secrets.read",
  "database.write", "email.send", "git.commit", "git.push"
]);

const EFFECT_RISK: Partial<Record<CapabilityEffect, number>> = {
  "filesystem.read": 5,
  "filesystem.write": 20,
  "network.connect": 20,
  "process.spawn": 30,
  "environment.read": 8,
  "secrets.read": 35,
  "database.read": 10,
  "database.write": 25,
  "email.send": 30,
  "git.commit": 20,
  "git.push": 30
};

function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }
function tokens(value: string): string[] { return unique(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1)); }
function jaccard(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a), right = new Set(b);
  if (!left.size && !right.size) return 1;
  const intersection = [...left].filter((value) => right.has(value)).length;
  return intersection / new Set([...left, ...right]).size;
}

function schemaFeatures(schema: JsonSchema | undefined, prefix = "$", depth = 0): string[] {
  if (!schema || depth > 3) return [];
  const features: string[] = [];
  const type = typeof schema.type === "string" ? schema.type : "any";
  features.push(`${prefix}:type=${type}`);
  if (Array.isArray(schema.required)) for (const key of schema.required) if (typeof key === "string") features.push(`${prefix}:required=${key}`);
  const properties = schema.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
      features.push(`${prefix}:property=${key}`);
      if (value && typeof value === "object" && !Array.isArray(value)) features.push(...schemaFeatures(value as JsonSchema, `${prefix}.${key}`, depth + 1));
    }
  }
  if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) features.push(...schemaFeatures(schema.items as JsonSchema, `${prefix}[]`, depth + 1));
  return unique(features);
}

function manifestText(manifest: CapabilityManifest): string[] {
  return tokens([manifest.id, manifest.name, manifest.description, ...(manifest.tags ?? [])].join(" "));
}

export type NoveltyMatch = {
  id: string;
  version: string;
  similarity: number;
  overlap: readonly string[];
};

export type NoveltyAssessment = {
  uniquenessScore: number;
  classification: "functional-twin" | "incremental" | "distinct" | "novel";
  nearest: readonly NoveltyMatch[];
  recommendation: string;
};

export function assessCapabilityNovelty(proposed: CapabilityManifest, existing: readonly CapabilityManifest[]): NoveltyAssessment {
  const proposedInput = schemaFeatures(proposed.input);
  const proposedOutput = schemaFeatures(proposed.output);
  const proposedEffects = proposed.effects ?? [];
  const proposedTags = proposed.tags ?? [];
  const scored = existing.filter((manifest) => manifest.id !== proposed.id || manifest.version !== proposed.version).map((manifest) => {
    const lexical = jaccard(manifestText(proposed), manifestText(manifest));
    const input = jaccard(proposedInput, schemaFeatures(manifest.input));
    const output = jaccard(proposedOutput, schemaFeatures(manifest.output));
    const effects = jaccard(proposedEffects, manifest.effects ?? []);
    const tags = jaccard(proposedTags, manifest.tags ?? []);
    const similarity = Math.min(1, lexical * 0.28 + input * 0.2 + output * 0.27 + effects * 0.15 + tags * 0.1);
    const overlap: string[] = [];
    if (lexical >= 0.65) overlap.push("purpose-language");
    if (input >= 0.8) overlap.push("input-contract");
    if (output >= 0.8) overlap.push("output-contract");
    if (effects >= 0.9) overlap.push("effect-profile");
    if (tags >= 0.7) overlap.push("tags");
    return { id: manifest.id, version: manifest.version, similarity: Number(similarity.toFixed(4)), overlap } satisfies NoveltyMatch;
  }).sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));
  const nearest = scored.slice(0, 5);
  const maximum = nearest[0]?.similarity ?? 0;
  const uniquenessScore = Math.round((1 - maximum) * 100);
  const classification = maximum >= 0.84 ? "functional-twin" : maximum >= 0.62 ? "incremental" : maximum >= 0.36 ? "distinct" : "novel";
  const recommendation = classification === "functional-twin"
    ? "Do not publish unchanged; differentiate the contract, authority profile, or outcome semantics."
    : classification === "incremental"
      ? "Publish only if the improvement is material and explicit in the contract or behavior."
      : classification === "distinct"
        ? "The capability occupies differentiated space; document why its contract is preferable for its target use."
        : "The capability occupies clear ecosystem whitespace; preserve that differentiation in the public manifest.";
  return { uniquenessScore, classification, nearest, recommendation };
}

export type AuthorityEnvelope = {
  effects: readonly CapabilityEffect[];
  openWorldEffects: readonly CapabilityEffect[];
  overDeclaredEffects: readonly CapabilityEffect[];
  perCapabilityOverDeclaration: Readonly<Record<string, readonly CapabilityEffect[]>>;
  riskScore: number;
  deterministic: boolean;
  fullyReversible: boolean;
};

export function calculateAuthorityEnvelope(manifests: readonly CapabilityManifest[], requiredEffects?: readonly CapabilityEffect[]): AuthorityEnvelope {
  const effects = unique(manifests.flatMap((manifest) => manifest.effects ?? [])).sort();
  const required = requiredEffects ? new Set(requiredEffects) : undefined;
  const overDeclaredEffects = required ? effects.filter((effect) => !required.has(effect)) : [];
  const perCapabilityOverDeclaration: Record<string, CapabilityEffect[]> = {};
  if (required) {
    for (const manifest of manifests) {
      const over = (manifest.effects ?? []).filter((effect) => !required.has(effect));
      if (over.length) perCapabilityOverDeclaration[manifest.id] = unique(over).sort();
    }
  }
  const rawRisk = effects.reduce((sum, effect) => sum + (EFFECT_RISK[effect] ?? (effect.startsWith("custom:") ? 18 : 10)), 0);
  return {
    effects,
    openWorldEffects: effects.filter((effect) => OPEN_WORLD.has(effect)),
    overDeclaredEffects,
    perCapabilityOverDeclaration,
    riskScore: Math.min(100, rawRisk),
    deterministic: manifests.every((manifest) => manifest.behavior?.deterministic === true),
    fullyReversible: manifests.every((manifest) => (manifest.effects?.length ?? 0) === 0 || manifest.behavior?.reversible === true)
  };
}

function objectContract(schema: JsonSchema | undefined) {
  const properties = schema?.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, unknown> : {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((key): key is string => typeof key === "string") : []);
  const types = new Map<string, string>();
  for (const [key, value] of Object.entries(properties)) {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).type === "string") types.set(key, (value as Record<string, unknown>).type as string);
    else types.set(key, "any");
  }
  return { properties: new Set(Object.keys(properties)), required, types };
}

export type ContractRoute = {
  id: string;
  compatible: boolean;
  projection: readonly string[];
  missing: readonly string[];
  typeMismatches: readonly string[];
  score: number;
};

export function routeCapabilityContracts(producerOutput: JsonSchema | undefined, consumers: readonly { id: string; input?: JsonSchema }[]): readonly ContractRoute[] {
  const producer = objectContract(producerOutput);
  return consumers.map((consumer) => {
    const target = objectContract(consumer.input);
    const missing = [...target.required].filter((key) => !producer.properties.has(key));
    const typeMismatches = [...target.required].filter((key) => {
      if (!producer.properties.has(key)) return false;
      const from = producer.types.get(key) ?? "any", to = target.types.get(key) ?? "any";
      return from !== "any" && to !== "any" && from !== to;
    });
    const projection = [...target.properties].filter((key) => producer.properties.has(key));
    const compatible = missing.length === 0 && typeMismatches.length === 0;
    const requiredCount = Math.max(1, target.required.size);
    const fulfilled = [...target.required].filter((key) => producer.properties.has(key) && !typeMismatches.includes(key)).length;
    const score = Math.round((fulfilled / requiredCount) * 100);
    return { id: consumer.id, compatible, projection, missing, typeMismatches, score };
  }).sort((a, b) => Number(b.compatible) - Number(a.compatible) || b.score - a.score || a.id.localeCompare(b.id));
}

export type ReceiptDriftAssessment = {
  severity: "none" | "low" | "medium" | "high" | "critical";
  reproducible: boolean;
  changes: readonly string[];
  score: number;
};

export function assessReceiptDrift(baseline: CapabilityReceipt, current: CapabilityReceipt): ReceiptDriftAssessment {
  let score = 0;
  const changes: string[] = [];
  const add = (points: number, change: string) => { score += points; changes.push(change); };
  if (baseline.capability.id !== current.capability.id) add(100, "capability-id");
  if (baseline.capability.version !== current.capability.version) add(20, "capability-version");
  if (baseline.inputHash === current.inputHash && baseline.outputHash && current.outputHash && baseline.outputHash !== current.outputHash) add(55, "same-input-different-output");
  if (baseline.inputHash !== current.inputHash) add(5, "input-changed");
  if (JSON.stringify([...baseline.effects].sort()) !== JSON.stringify([...current.effects].sort())) add(30, "effect-envelope");
  if (baseline.provenance?.packageName !== current.provenance?.packageName) add(35, "package-identity");
  if (baseline.provenance?.packageVersion !== current.provenance?.packageVersion) add(15, "package-version");
  if (baseline.provenance?.packageIntegrity && current.provenance?.packageIntegrity && baseline.provenance.packageIntegrity !== current.provenance.packageIntegrity) add(50, "package-integrity");
  if (baseline.verification?.ok !== current.verification?.ok) add(35, "verification-result");
  score = Math.min(100, score);
  const severity = score === 0 ? "none" : score < 20 ? "low" : score < 45 ? "medium" : score < 75 ? "high" : "critical";
  const reproducible = baseline.capability.id === current.capability.id
    && baseline.capability.version === current.capability.version
    && baseline.inputHash === current.inputHash
    && baseline.outputHash !== undefined
    && baseline.outputHash === current.outputHash
    && JSON.stringify([...baseline.effects].sort()) === JSON.stringify([...current.effects].sort())
    && (baseline.provenance?.packageIntegrity ?? null) === (current.provenance?.packageIntegrity ?? null);
  return { severity, reproducible, changes, score };
}

export type FailureFrontierStep = {
  id: string;
  effects?: readonly CapabilityEffect[];
  behavior?: { idempotent?: boolean; reversible?: boolean };
};

export type FailureFrontier = {
  pointOfNoReturn: string | null;
  approvalCheckpoints: readonly string[];
  retrySafePrefixLength: number;
  compensationCoverage: number;
  effects: readonly CapabilityEffect[];
};

export function calculateFailureFrontier(steps: readonly FailureFrontierStep[]): FailureFrontier {
  const mutating = steps.filter((step) => (step.effects ?? []).some((effect) => OPEN_WORLD.has(effect)));
  const point = mutating.find((step) => step.behavior?.reversible !== true) ?? null;
  let retrySafePrefixLength = 0;
  for (const step of steps) {
    if (step.behavior?.idempotent !== true) break;
    retrySafePrefixLength += 1;
  }
  const reversibleMutations = mutating.filter((step) => step.behavior?.reversible === true).length;
  const compensationCoverage = mutating.length ? Math.round((reversibleMutations / mutating.length) * 100) : 100;
  return {
    pointOfNoReturn: point?.id ?? null,
    approvalCheckpoints: mutating.map((step) => step.id),
    retrySafePrefixLength,
    compensationCoverage,
    effects: unique(steps.flatMap((step) => step.effects ?? [])).sort()
  };
}
