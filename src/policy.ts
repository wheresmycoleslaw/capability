import type { AuthorizationDecision, CapabilityEffect, CapabilityPolicy } from "./types.js";

export const MUTATING_OR_OPEN_WORLD_EFFECTS: readonly CapabilityEffect[] = [
  "filesystem.write", "network.connect", "process.spawn", "secrets.read",
  "database.write", "email.send", "git.commit", "git.push"
];

function matches(pattern: string, effect: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return effect.startsWith(pattern.slice(0, -1));
  return pattern === effect;
}

function anyMatch(patterns: readonly string[], effect: string): boolean { return patterns.some((pattern) => matches(pattern, effect)); }

export const denyAllPolicy: CapabilityPolicy = Object.freeze({ allow: [] });
export const readOnlyPolicy: CapabilityPolicy = Object.freeze({ allow: ["filesystem.read", "environment.read", "database.read"] });
export const permissivePolicy: CapabilityPolicy = Object.freeze({ allow: ["*"], requireApproval: [...MUTATING_OR_OPEN_WORLD_EFFECTS, "custom:*"] });

export function authorizeEffects(effects: readonly CapabilityEffect[], policy: CapabilityPolicy, approved = false): AuthorizationDecision {
  const allow = policy.allow ?? [];
  const deny = policy.deny ?? [];
  const requireApproval = policy.requireApproval ?? [];
  const deniedEffects = effects.filter((effect) => anyMatch(deny, effect) || !anyMatch(allow, effect));
  const approvalRequired = approved ? [] : effects.filter((effect) => anyMatch(requireApproval, effect));
  if (deniedEffects.length) return { allowed: false, deniedEffects, approvalRequired: [], reason: `denied effects: ${deniedEffects.join(", ")}` };
  if (approvalRequired.length) return { allowed: false, deniedEffects: [], approvalRequired, reason: `approval required for: ${approvalRequired.join(", ")}` };
  return { allowed: true, deniedEffects: [], approvalRequired: [] };
}
