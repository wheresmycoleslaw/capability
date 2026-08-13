import { CapabilityError } from "./errors.js";
import {
  CAPABILITY_SPEC_VERSION,
  type CapabilityEffect,
  type CapabilityEffects,
  type CapabilityManifest,
  type LegacyCapabilityDefinition
} from "./types.js";
import { deepFreeze, slugify, unique } from "./utils.js";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const BUILT_IN_EFFECTS = new Set<string>([
  "filesystem.read", "filesystem.write", "network.connect", "process.spawn",
  "environment.read", "secrets.read", "database.read", "database.write",
  "email.send", "git.commit", "git.push"
]);

export function isCapabilityEffect(value: string): value is CapabilityEffect {
  return BUILT_IN_EFFECTS.has(value) || /^custom:[a-z0-9][a-z0-9._/-]*$/.test(value);
}

export function validateManifest(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object") return ["manifest must be an object"];
  const value = manifest as Record<string, unknown>;
  const issues: string[] = [];
  if (value.specVersion !== CAPABILITY_SPEC_VERSION) issues.push(`specVersion must be ${CAPABILITY_SPEC_VERSION}`);
  if (typeof value.id !== "string" || !ID_PATTERN.test(value.id)) issues.push("id must be a stable namespace/name identifier");
  if (typeof value.version !== "string" || !SEMVER_PATTERN.test(value.version)) issues.push("version must be valid semantic versioning");
  if (typeof value.name !== "string" || !value.name.trim()) issues.push("name is required");
  if (typeof value.description !== "string" || !value.description.trim()) issues.push("description is required");
  if (value.effects !== undefined) {
    if (!Array.isArray(value.effects)) issues.push("effects must be an array");
    else for (const effect of value.effects) {
      if (typeof effect !== "string" || !isCapabilityEffect(effect)) issues.push(`invalid effect: ${String(effect)}`);
    }
  }
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string"))) {
    issues.push("tags must be an array of strings");
  }
  return issues;
}

export function assertValidManifest(manifest: unknown): asserts manifest is CapabilityManifest {
  const issues = validateManifest(manifest);
  if (issues.length) throw new CapabilityError("INVALID_MANIFEST", issues.join("; "), issues);
}

export function normalizeLegacyEffects(effects: CapabilityEffects | readonly CapabilityEffect[] | undefined): CapabilityEffect[] {
  if (!effects) return [];
  if (Array.isArray(effects)) return unique(effects as readonly CapabilityEffect[]);
  const legacy = effects as CapabilityEffects;
  const result: CapabilityEffect[] = [];
  if (legacy.filesystem?.read) result.push("filesystem.read");
  if (legacy.filesystem?.write) result.push("filesystem.write");
  if (legacy.network) result.push("network.connect");
  if (legacy.shell) result.push("process.spawn");
  if (legacy.environment) result.push("environment.read");
  return result;
}

export function manifestFromLegacy<Input, Output>(definition: LegacyCapabilityDefinition<Input, Output>): CapabilityManifest {
  const manifest: CapabilityManifest = {
    specVersion: CAPABILITY_SPEC_VERSION,
    id: definition.id ?? `local/${slugify(definition.name)}`,
    version: definition.version ?? "0.0.0",
    name: definition.name,
    description: definition.description,
    input: definition.input,
    output: definition.output,
    effects: normalizeLegacyEffects(definition.effects),
    behavior: definition.behavior ?? {},
    tags: definition.tags ?? []
  };
  assertValidManifest(manifest);
  return deepFreeze(manifest) as Readonly<CapabilityManifest> as CapabilityManifest;
}
