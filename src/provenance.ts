import type { Capability, CapabilityProvenance } from "./types.js";
import { createHash } from "node:crypto";
import { deepFreeze } from "./utils.js";

const records = new WeakMap<object, Readonly<CapabilityProvenance>>();

export function attachProvenance<T extends Capability>(capability: T, provenance: CapabilityProvenance): T {
  records.set(capability, deepFreeze({ ...provenance }) as Readonly<CapabilityProvenance>);
  return capability;
}

export function getProvenance(capability: Capability): Readonly<CapabilityProvenance> | undefined { return records.get(capability); }

export function verifySha256Integrity(content: string | Uint8Array, integrity: string): boolean {
  const expected = integrity.startsWith("sha256-") ? integrity.slice(7) : integrity;
  const hash = createHash("sha256").update(content);
  if (/^[a-f0-9]{64}$/i.test(expected)) return hash.digest("hex").toLowerCase() === expected.toLowerCase();
  return hash.digest("base64") === expected;
}
