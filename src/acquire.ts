import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { CapabilityError } from "./errors.js";
import { assertPackageDeclaration, inspectPackageDeclaration, type CapabilityPackageExport, type PackageJsonWithCapabilities } from "./package.js";
import type { Capability, CapabilityManifest } from "./types.js";
import { attachProvenance, verifySha256Integrity } from "./provenance.js";
import { deepFreeze, sha256 } from "./utils.js";

export type InspectedCapabilityPackageEntry = { id: string; module: string; manifest: Readonly<CapabilityManifest>; integrity?: string };
export type InspectedCapabilityPackage = { name?: string; version?: string; manifests: readonly Readonly<CapabilityManifest>[]; entries: readonly InspectedCapabilityPackageEntry[] };
function modulePath(entry: CapabilityPackageExport): string { return typeof entry === "string" ? entry : entry.module; }
function repositoryUrl(repository: PackageJsonWithCapabilities["repository"]): string | undefined { if (typeof repository === "string") return repository; return repository?.url; }

export async function inspectCapabilityPackage(packageJsonPath: string): Promise<InspectedCapabilityPackage> {
  const packageJson = JSON.parse(await readFile(resolve(packageJsonPath), "utf8")) as PackageJsonWithCapabilities;
  assertPackageDeclaration(packageJson.capability);
  const declaration = packageJson.capability;
  const manifests = inspectPackageDeclaration(declaration);
  const manifestById = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const entries: InspectedCapabilityPackageEntry[] = [];
  for (const [id, entry] of Object.entries(declaration.exports)) {
    if (typeof entry === "string") continue;
    const manifest = manifestById.get(id);
    if (manifest) entries.push({ id, module: entry.module, manifest, ...(entry.integrity ? { integrity: entry.integrity } : {}) });
  }
  return { name: packageJson.name, version: packageJson.version, manifests, entries };
}

async function readPackage(packageJsonPath: string) {
  const absolutePackageJson = resolve(packageJsonPath);
  const packageJson = JSON.parse(await readFile(absolutePackageJson, "utf8")) as PackageJsonWithCapabilities;
  assertPackageDeclaration(packageJson.capability);
  return { absolutePackageJson, packageJson, declaration: packageJson.capability };
}

function resolveModule(root: string, expectedId: string, entry: CapabilityPackageExport): { relativePath: string; absoluteModule: string; moduleUrl: string } {
  const relativePath = modulePath(entry);
  const absoluteModule = resolve(root, relativePath);
  const escaped = relative(root, absoluteModule);
  if (escaped === ".." || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) throw new CapabilityError("INVALID_PACKAGE_DECLARATION", `Export ${expectedId} escapes package root`);
  return { relativePath, absoluteModule, moduleUrl: pathToFileURL(absoluteModule).href };
}

async function verifyModuleIntegrity(entry: CapabilityPackageExport, expectedId: string, absoluteModule: string): Promise<void> {
  if (typeof entry !== "string" && entry.integrity) {
    const bytes = await readFile(absoluteModule);
    if (!verifySha256Integrity(bytes, entry.integrity)) throw new CapabilityError("INVALID_PACKAGE_DECLARATION", `Integrity check failed for ${expectedId}`);
  } else {
    await readFile(absoluteModule);
  }
}

function provenanceFor(root: string, moduleUrl: string, packageJson: PackageJsonWithCapabilities, entry: CapabilityPackageExport) {
  return {
    source: moduleUrl,
    packageRoot: root,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    ...(repositoryUrl(packageJson.repository) ? { repository: repositoryUrl(packageJson.repository) } : {}),
    ...(typeof entry !== "string" && entry.integrity ? { integrity: entry.integrity } : {})
  };
}

/**
 * Build an inert module-backed capability from package metadata without importing executable code.
 * Use with an out-of-process executor. String-only package exports are intentionally rejected because
 * they do not provide inert manifest metadata to bind before code loading.
 */
export async function inspectModuleBackedCapability(packageJsonPath: string, expectedId: string): Promise<Capability> {
  const { absolutePackageJson, packageJson, declaration } = await readPackage(packageJsonPath);
  const root = dirname(absolutePackageJson);
  const entry = declaration.exports[expectedId];
  if (!entry) throw new CapabilityError("NOT_FOUND", `Package does not export capability: ${expectedId}`);
  if (typeof entry === "string") throw new CapabilityError("INVALID_PACKAGE_DECLARATION", `Safe acquisition requires an inert manifest descriptor for ${expectedId}`);
  const { absoluteModule, moduleUrl } = resolveModule(root, expectedId, entry);
  await verifyModuleIntegrity(entry, expectedId, absoluteModule);
  const manifest = deepFreeze({ ...entry.manifest }) as Readonly<CapabilityManifest>;
  const capability: Capability = Object.freeze({
    manifest,
    execute() { throw new CapabilityError("EXECUTION_FAILED", `Module-backed capability ${expectedId} requires an isolated executor`); }
  });
  return attachProvenance(capability, provenanceFor(root, moduleUrl, packageJson, entry));
}

export async function loadCapabilityFromPackage(packageJsonPath: string, expectedId: string): Promise<Capability> {
  const { absolutePackageJson, packageJson, declaration } = await readPackage(packageJsonPath);
  const root = dirname(absolutePackageJson);
  const entry = declaration.exports[expectedId];
  if (!entry) throw new CapabilityError("NOT_FOUND", `Package does not export capability: ${expectedId}`);
  const { relativePath, absoluteModule, moduleUrl } = resolveModule(root, expectedId, entry);
  await verifyModuleIntegrity(entry, expectedId, absoluteModule);
  const module = await import(moduleUrl) as Record<string, unknown>;
  const capability = (module.default ?? module.capability) as Capability | undefined;
  if (!capability?.manifest || typeof capability.execute !== "function") throw new CapabilityError("INVALID_PACKAGE_DECLARATION", `${relativePath} does not export a capability`);
  if (capability.manifest.id !== expectedId) throw new CapabilityError("INVALID_PACKAGE_DECLARATION", `Export ${expectedId} resolved to manifest id ${capability.manifest.id}`);
  if (typeof entry !== "string" && sha256(entry.manifest) !== sha256(capability.manifest)) throw new CapabilityError("INVALID_PACKAGE_DECLARATION", `Loaded manifest for ${expectedId} does not match inert package metadata`);
  return attachProvenance(capability, provenanceFor(root, moduleUrl, packageJson, entry));
}

export async function loadCapabilityPackage(packageJsonPath: string): Promise<Capability[]> {
  const { declaration } = await readPackage(packageJsonPath);
  const capabilities: Capability[] = [];
  for (const id of Object.keys(declaration.exports)) capabilities.push(await loadCapabilityFromPackage(packageJsonPath, id));
  return capabilities;
}
