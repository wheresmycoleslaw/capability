import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { InstalledCapabilityPackage } from "./installer.js";
import type { CapabilityIndexDocument, PublicIndexResult } from "./public-index.js";
import { sha256 } from "./utils.js";

export const CAPABILITY_LOCK_VERSION = "1" as const;

export type CapabilityLockfile = {
  lockVersion: typeof CAPABILITY_LOCK_VERSION;
  generatedAt: string;
  index: { url: string; digest: string };
  package: { name: string; version: string; integrity?: string };
  capability: { id: string; version: string; module: string; integrity?: string };
};

export function validateCapabilityLock(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["lockfile must be an object"];
  const lock = value as Record<string, unknown>;
  const issues: string[] = [];
  if (lock.lockVersion !== CAPABILITY_LOCK_VERSION) issues.push(`lockVersion must be ${CAPABILITY_LOCK_VERSION}`);
  if (typeof lock.generatedAt !== "string" || Number.isNaN(Date.parse(lock.generatedAt))) issues.push("generatedAt must be an ISO date string");
  const index = lock.index as Record<string, unknown> | undefined;
  if (!index || typeof index !== "object" || typeof index.url !== "string" || typeof index.digest !== "string") issues.push("index.url and index.digest are required");
  const pkg = lock.package as Record<string, unknown> | undefined;
  if (!pkg || typeof pkg !== "object" || typeof pkg.name !== "string" || typeof pkg.version !== "string") issues.push("package.name and package.version are required");
  const cap = lock.capability as Record<string, unknown> | undefined;
  if (!cap || typeof cap !== "object" || typeof cap.id !== "string" || typeof cap.version !== "string" || typeof cap.module !== "string") issues.push("capability.id, capability.version and capability.module are required");
  return issues;
}

export function createCapabilityLock(
  result: PublicIndexResult,
  indexUrl: string,
  index: CapabilityIndexDocument,
  installed?: InstalledCapabilityPackage,
  now = new Date()
): CapabilityLockfile {
  return {
    lockVersion: CAPABILITY_LOCK_VERSION,
    generatedAt: now.toISOString(),
    index: { url: indexUrl, digest: sha256(index) },
    package: {
      name: result.package.name,
      version: result.package.version,
      ...(installed?.packageIntegrity ?? result.package.integrity ? { integrity: installed?.packageIntegrity ?? result.package.integrity } : {})
    },
    capability: {
      id: result.capability.manifest.id,
      version: result.capability.manifest.version,
      module: result.capability.module,
      ...(result.capability.integrity ? { integrity: result.capability.integrity } : {})
    }
  };
}

export async function writeCapabilityLock(path: string, lock: CapabilityLockfile): Promise<void> {
  const issues = validateCapabilityLock(lock);
  if (issues.length) throw new TypeError(`Invalid capability lock: ${issues.join("; ")}`);
  await writeFile(resolve(path), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

export async function readCapabilityLock(path: string): Promise<CapabilityLockfile> {
  const lock = JSON.parse(await readFile(resolve(path), "utf8")) as CapabilityLockfile;
  const issues = validateCapabilityLock(lock);
  if (issues.length) throw new TypeError(`Invalid capability lock: ${issues.join("; ")}`);
  return lock;
}

export function resolveCapabilityLock(index: CapabilityIndexDocument, lock: CapabilityLockfile): PublicIndexResult {
  const pkg = index.packages.find((entry) => entry.name === lock.package.name && entry.version === lock.package.version);
  if (!pkg) throw new Error(`Locked package is not present in index: ${lock.package.name}@${lock.package.version}`);
  if (lock.package.integrity && pkg.integrity && lock.package.integrity !== pkg.integrity) throw new Error("Locked package integrity differs from index");
  const capability = pkg.capabilities.find((entry) => entry.manifest.id === lock.capability.id && entry.manifest.version === lock.capability.version && entry.module === lock.capability.module);
  if (!capability) throw new Error(`Locked capability is not present in index: ${lock.capability.id}@${lock.capability.version}`);
  if (lock.capability.integrity && capability.integrity && lock.capability.integrity !== capability.integrity) throw new Error("Locked module integrity differs from index");
  return { package: pkg, capability, score: Number.MAX_SAFE_INTEGER, reasons: ["lockfile"] };
}
