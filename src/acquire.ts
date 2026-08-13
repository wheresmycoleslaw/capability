import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CapabilityError } from "./errors.js";
import {
  assertPackageDeclaration,
  inspectPackageDeclaration,
  type CapabilityPackageExport,
  type PackageJsonWithCapabilities
} from "./package.js";
import type { Capability, CapabilityManifest } from "./types.js";
import { attachProvenance, verifySha256Integrity } from "./provenance.js";
import { sha256 } from "./utils.js";

export type InspectedCapabilityPackageEntry = {
  id: string;
  module: string;
  manifest: Readonly<CapabilityManifest>;
  integrity?: string;
};

export type InspectedCapabilityPackage = {
  name?: string;
  version?: string;
  manifests: readonly Readonly<CapabilityManifest>[];
  entries: readonly InspectedCapabilityPackageEntry[];
};

function modulePath(entry: CapabilityPackageExport): string {
  return typeof entry === "string" ? entry : entry.module;
}

export async function inspectCapabilityPackage(packageJsonPath: string): Promise<InspectedCapabilityPackage> {
  const packageJson = JSON.parse(await readFile(resolve(packageJsonPath), "utf8")) as PackageJsonWithCapabilities;
  assertPackageDeclaration(packageJson.capability);
  const declaration = packageJson.capability;
  const manifests = inspectPackageDeclaration(declaration);
  const manifestById = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const entries: InspectedCapabilityPackageEntry[] = [];
  for (const [id, entry] of Object.entries(declaration.exports)) {
    if (typeof entry === "string") continue; // legacy export is loadable but not inertly inspectable
    const manifest = manifestById.get(id);
    if (manifest) entries.push({ id, module: entry.module, manifest, ...(entry.integrity ? { integrity: entry.integrity } : {}) });
  }
  return { name: packageJson.name, version: packageJson.version, manifests, entries };
}

async function readPackage(packageJsonPath: string) {
  const absolutePackageJson = resolve(packageJsonPath);
  const packageJson = JSON.parse(await readFile(absolutePackageJson, "utf8")) as PackageJsonWithCapabilities;
  assertPackageDeclaration(packageJson.capability);
  const declaration = packageJson.capability;
  return { absolutePackageJson, packageJson, declaration };
}

export async function loadCapabilityFromPackage(packageJsonPath: string, expectedId: string): Promise<Capability> {
  const { absolutePackageJson, packageJson, declaration } = await readPackage(packageJsonPath);
  const root = dirname(absolutePackageJson);
  const entry = declaration.exports[expectedId];
  if (!entry) throw new CapabilityError("NOT_FOUND", `Package does not export capability: ${expectedId}`);
  const relativePath = modulePath(entry);
  const absoluteModule = resolve(root, relativePath);
  const moduleUrl = pathToFileURL(absoluteModule).href;
  if (typeof entry !== "string" && entry.integrity) {
    const bytes = await readFile(absoluteModule);
    if (!verifySha256Integrity(bytes, entry.integrity)) {
      throw new CapabilityError("INVALID_PACKAGE_DECLARATION", `Integrity check failed for ${expectedId}`);
    }
  }
  const module = await import(moduleUrl) as Record<string, unknown>;
  const capability = (module.default ?? module.capability) as Capability | undefined;
  if (!capability?.manifest || typeof capability.execute !== "function") {
    throw new CapabilityError("INVALID_PACKAGE_DECLARATION", `${relativePath} does not export a capability`);
  }
  if (capability.manifest.id !== expectedId) {
    throw new CapabilityError("INVALID_PACKAGE_DECLARATION", `Export ${expectedId} resolved to manifest id ${capability.manifest.id}`);
  }
  if (typeof entry !== "string" && sha256(entry.manifest) !== sha256(capability.manifest)) {
    throw new CapabilityError("INVALID_PACKAGE_DECLARATION", `Loaded manifest for ${expectedId} does not match inert package metadata`);
  }
  return attachProvenance(capability, {
    source: moduleUrl,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    ...(typeof entry !== "string" && entry.integrity ? { integrity: entry.integrity } : {})
  });
}

export async function loadCapabilityPackage(packageJsonPath: string): Promise<Capability[]> {
  const { declaration } = await readPackage(packageJsonPath);
  const capabilities: Capability[] = [];
  for (const id of Object.keys(declaration.exports)) {
    capabilities.push(await loadCapabilityFromPackage(packageJsonPath, id));
  }
  return capabilities;
}
