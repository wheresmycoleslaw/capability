import type { CapabilityEffect, CapabilityManifest, JsonSchema } from "./types.js";
import { sha256 } from "./utils.js";

function objectShape(schema: JsonSchema | undefined) {
  const properties = schema?.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, unknown> : {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((value): value is string => typeof value === "string") : []);
  const types = new Map<string, string>();
  for (const [key, value] of Object.entries(properties)) {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).type === "string") types.set(key, String((value as Record<string, unknown>).type));
    else types.set(key, "any");
  }
  return { properties: new Set(Object.keys(properties)), required, types };
}

function compatibleType(from: string, to: string): boolean { return from === "any" || to === "any" || from === to; }
function sorted<T extends string>(values: Iterable<T>): T[] { return [...new Set(values)].sort() as T[]; }

/**
 * Conservative compatibility check for the object-schema subset Capability currently uses most often.
 * `replacementInput` must accept every required field the original required without adding a new required field.
 * `replacementOutput` must preserve every output field the original guaranteed.
 */
export function assessContractSubstitution(original: CapabilityManifest, replacement: CapabilityManifest) {
  const oldInput = objectShape(original.input), nextInput = objectShape(replacement.input);
  const oldOutput = objectShape(original.output), nextOutput = objectShape(replacement.output);
  const reasons: string[] = [];
  const breaking: string[] = [];

  for (const key of nextInput.required) {
    if (!oldInput.required.has(key)) breaking.push(`replacement requires new input field: ${key}`);
  }
  for (const key of oldInput.properties) {
    if (!nextInput.properties.has(key)) continue;
    const oldType = oldInput.types.get(key) ?? "any", nextType = nextInput.types.get(key) ?? "any";
    if (!compatibleType(oldType, nextType)) breaking.push(`input type changed for ${key}: ${oldType} -> ${nextType}`);
  }
  for (const key of oldOutput.required) {
    if (!nextOutput.required.has(key)) breaking.push(`replacement no longer guarantees output field: ${key}`);
    else {
      const oldType = oldOutput.types.get(key) ?? "any", nextType = nextOutput.types.get(key) ?? "any";
      if (!compatibleType(nextType, oldType)) breaking.push(`output type changed for ${key}: ${oldType} -> ${nextType}`);
    }
  }
  if (!breaking.length) reasons.push("conservative input/output contract compatibility passed");
  return { compatible: breaking.length === 0, breaking, reasons };
}

export type SubstitutionTrust = {
  score?: number;
  packageIntegrity?: string;
  provenanceVerified?: boolean;
  registrySignatureVerified?: boolean;
};

export type SubstitutionCertificate = {
  accepted: boolean;
  original: { id: string; version: string };
  replacement: { id: string; version: string };
  authorityDelta: { removed: readonly CapabilityEffect[]; added: readonly CapabilityEffect[] };
  behaviorRegressions: readonly string[];
  contractBreaking: readonly string[];
  trustRegression: boolean;
  reasons: readonly string[];
  certificate: string;
};

/**
 * Issues a deterministic certificate only when a replacement is contract-compatible,
 * does not expand authority, does not weaken declared behavioral guarantees, and does not lower trust.
 */
export function certifyCapabilitySubstitution(
  original: CapabilityManifest,
  replacement: CapabilityManifest,
  originalTrust: SubstitutionTrust = {},
  replacementTrust: SubstitutionTrust = {}
): SubstitutionCertificate {
  const contract = assessContractSubstitution(original, replacement);
  const oldEffects = new Set(original.effects ?? []), newEffects = new Set(replacement.effects ?? []);
  const added = sorted([...newEffects].filter((effect) => !oldEffects.has(effect)));
  const removed = sorted([...oldEffects].filter((effect) => !newEffects.has(effect)));
  const behaviorRegressions: string[] = [];
  if (original.behavior?.deterministic === true && replacement.behavior?.deterministic !== true) behaviorRegressions.push("determinism weakened");
  if (original.behavior?.idempotent === true && replacement.behavior?.idempotent !== true) behaviorRegressions.push("idempotence weakened");
  if (original.behavior?.reversible === true && replacement.behavior?.reversible !== true) behaviorRegressions.push("reversibility weakened");
  const originalScore = originalTrust.score ?? 0, replacementScore = replacementTrust.score ?? 0;
  const trustRegression = replacementScore < originalScore
    || originalTrust.provenanceVerified === true && replacementTrust.provenanceVerified !== true
    || originalTrust.registrySignatureVerified === true && replacementTrust.registrySignatureVerified !== true;
  const reasons: string[] = [];
  if (!added.length) reasons.push("authority did not expand");
  if (!behaviorRegressions.length) reasons.push("declared behavioral guarantees did not weaken");
  if (!trustRegression) reasons.push("trust posture did not regress");
  reasons.push(...contract.reasons);
  const accepted = contract.compatible && added.length === 0 && behaviorRegressions.length === 0 && !trustRegression;
  const body = {
    original: { id: original.id, version: original.version },
    replacement: { id: replacement.id, version: replacement.version },
    authorityDelta: { removed, added },
    behaviorRegressions,
    contractBreaking: contract.breaking,
    trustRegression,
    accepted
  };
  return { ...body, reasons, certificate: `sha256-${sha256(body)}` };
}

export type EvolutionAssessment = {
  classification: "safe-patch" | "authority-reducing" | "review-required" | "breaking";
  semverRecommendation: "patch" | "minor" | "major";
  substitution: SubstitutionCertificate;
  changes: readonly string[];
};

/** Classifies a capability contract change using semantics that ordinary SemVer cannot see: effects and behavioral guarantees. */
export function assessCapabilityEvolution(previous: CapabilityManifest, next: CapabilityManifest): EvolutionAssessment {
  const substitution = certifyCapabilitySubstitution(previous, next);
  const changes: string[] = [];
  if (previous.version !== next.version) changes.push(`version ${previous.version} -> ${next.version}`);
  if (substitution.authorityDelta.removed.length) changes.push(`authority reduced: ${substitution.authorityDelta.removed.join(", ")}`);
  if (substitution.authorityDelta.added.length) changes.push(`authority expanded: ${substitution.authorityDelta.added.join(", ")}`);
  changes.push(...substitution.behaviorRegressions, ...substitution.contractBreaking);
  if (!substitution.accepted) return { classification: "breaking", semverRecommendation: "major", substitution, changes };
  if (substitution.authorityDelta.removed.length) return { classification: "authority-reducing", semverRecommendation: "minor", substitution, changes };
  const sameContract = JSON.stringify(previous.input ?? null) === JSON.stringify(next.input ?? null)
    && JSON.stringify(previous.output ?? null) === JSON.stringify(next.output ?? null)
    && JSON.stringify(previous.effects ?? []) === JSON.stringify(next.effects ?? [])
    && JSON.stringify(previous.behavior ?? {}) === JSON.stringify(next.behavior ?? {});
  return { classification: sameContract ? "safe-patch" : "review-required", semverRecommendation: sameContract ? "patch" : "minor", substitution, changes };
}

export type DominanceCandidate = {
  manifest: CapabilityManifest;
  trustScore?: number;
  provenanceVerified?: boolean;
  registrySignatureVerified?: boolean;
};

export type DominanceResult = {
  frontier: readonly { id: string; version: string; risk: number; trust: number; deterministic: boolean; reversible: boolean }[];
  dominated: readonly { id: string; version: string; dominatedBy: string }[];
};

const RISK: Partial<Record<CapabilityEffect, number>> = {
  "filesystem.read": 5, "filesystem.write": 20, "network.connect": 20, "process.spawn": 30,
  "environment.read": 8, "secrets.read": 35, "database.read": 10, "database.write": 25,
  "email.send": 30, "git.commit": 20, "git.push": 30
};
function risk(manifest: CapabilityManifest): number { return Math.min(100, (manifest.effects ?? []).reduce((sum, effect) => sum + (RISK[effect] ?? 18), 0)); }
function metrics(candidate: DominanceCandidate) {
  return {
    id: candidate.manifest.id,
    version: candidate.manifest.version,
    risk: risk(candidate.manifest),
    trust: candidate.trustScore ?? 0,
    deterministic: candidate.manifest.behavior?.deterministic === true,
    reversible: candidate.manifest.behavior?.reversible === true
  };
}
function dominates(a: ReturnType<typeof metrics>, b: ReturnType<typeof metrics>): boolean {
  const noWorse = a.risk <= b.risk && a.trust >= b.trust && Number(a.deterministic) >= Number(b.deterministic) && Number(a.reversible) >= Number(b.reversible);
  const better = a.risk < b.risk || a.trust > b.trust || Number(a.deterministic) > Number(b.deterministic) || Number(a.reversible) > Number(b.reversible);
  return noWorse && better;
}

/** Returns the Pareto frontier for interchangeable candidates instead of collapsing safety/trust into one opaque score. */
export function resolveCapabilityDominance(candidates: readonly DominanceCandidate[]): DominanceResult {
  const values = candidates.map(metrics);
  const dominated: { id: string; version: string; dominatedBy: string }[] = [];
  const frontier = values.filter((candidate, index) => {
    const superior = values.find((other, otherIndex) => otherIndex !== index && dominates(other, candidate));
    if (superior) {
      dominated.push({ id: candidate.id, version: candidate.version, dominatedBy: `${superior.id}@${superior.version}` });
      return false;
    }
    return true;
  });
  frontier.sort((a, b) => a.risk - b.risk || b.trust - a.trust || a.id.localeCompare(b.id));
  dominated.sort((a, b) => a.id.localeCompare(b.id));
  return { frontier, dominated };
}
