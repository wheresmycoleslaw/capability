import type { Capability, CapabilityProvenance } from "./types.js";
import { getProvenance } from "./provenance.js";

export type CapabilityTrustPolicy = {
  minScore?: number;
  requirePackage?: boolean;
  requireIntegrity?: boolean;
  requireRepository?: boolean;
  requireCommit?: boolean;
  requireAttestation?: boolean;
  allowedPackages?: readonly string[];
  allowedRepositories?: readonly string[];
};

export type CapabilityTrustAssessment = { score: number; accepted: boolean; reasons: readonly string[]; failures: readonly string[]; provenance?: Readonly<CapabilityProvenance> };

function matchAllowed(value: string | undefined, allowed: readonly string[] | undefined): boolean {
  if (!allowed?.length) return true;
  if (!value) return false;
  return allowed.some((pattern) => pattern === value || (pattern.endsWith("*") && value.startsWith(pattern.slice(0, -1))));
}

export function assessCapabilityTrust(capability: Capability, policy: CapabilityTrustPolicy = {}): CapabilityTrustAssessment {
  const provenance = getProvenance(capability);
  const reasons: string[] = [];
  const failures: string[] = [];
  let score = 10;
  if (provenance?.source) { score += 10; reasons.push("source observed"); }
  if (provenance?.packageName && provenance.packageVersion) { score += 20; reasons.push("package identity observed"); }
  if (provenance?.integrity) { score += 25; reasons.push("integrity recorded"); }
  if (provenance?.repository) { score += 10; reasons.push("repository recorded"); }
  if (provenance?.commit) { score += 10; reasons.push("commit recorded"); }
  if (provenance?.attestation) { score += 15; reasons.push("attestation recorded"); }
  score = Math.min(100, score);
  if (policy.requirePackage && !(provenance?.packageName && provenance.packageVersion)) failures.push("package identity required");
  if (policy.requireIntegrity && !provenance?.integrity) failures.push("integrity required");
  if (policy.requireRepository && !provenance?.repository) failures.push("repository required");
  if (policy.requireCommit && !provenance?.commit) failures.push("commit required");
  if (policy.requireAttestation && !provenance?.attestation) failures.push("attestation required");
  if (!matchAllowed(provenance?.packageName, policy.allowedPackages)) failures.push("package is not allowed");
  if (!matchAllowed(provenance?.repository, policy.allowedRepositories)) failures.push("repository is not allowed");
  if (score < (policy.minScore ?? 0)) failures.push(`trust score ${score} is below minimum ${policy.minScore}`);
  return { score, accepted: failures.length === 0, reasons, failures, ...(provenance ? { provenance } : {}) };
}

export function requireCapabilityTrust(capability: Capability, policy: CapabilityTrustPolicy): CapabilityTrustAssessment {
  const assessment = assessCapabilityTrust(capability, policy);
  if (!assessment.accepted) throw new Error(`Capability trust check failed: ${assessment.failures.join("; ")}`);
  return assessment;
}
