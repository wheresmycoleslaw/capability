import { CapabilityError } from "./errors.js";
import { assertValidManifest, validateManifest } from "./manifest.js";
import { CAPABILITY_SPEC_VERSION, type CapabilityManifest } from "./types.js";
import { deepFreeze } from "./utils.js";

export type CapabilityPackageExport =
  | string
  | {
      module: string;
      manifest: CapabilityManifest;
      integrity?: string;
    };

export type CapabilityPackageDeclaration = {
  specVersion: typeof CAPABILITY_SPEC_VERSION;
  exports: Record<string, CapabilityPackageExport>;
};

export type PackageJsonWithCapabilities = {
  name?: string;
  version?: string;
  repository?: string | { type?: string; url?: string };
  capability?: CapabilityPackageDeclaration;
};

function validateModulePath(id: string, path: unknown, issues: string[]) {
  if (typeof path !== "string" || !path.startsWith("./")) {
    issues.push(`export path for ${id} must start with ./`);
  }
}

export function validatePackageDeclaration(value: unknown): string[] {
  if (!value || typeof value !== "object") return ["package declaration must be an object"];
  const declaration = value as Record<string, unknown>;
  const issues: string[] = [];
  if (declaration.specVersion !== CAPABILITY_SPEC_VERSION) issues.push(`specVersion must be ${CAPABILITY_SPEC_VERSION}`);
  if (!declaration.exports || typeof declaration.exports !== "object" || Array.isArray(declaration.exports)) {
    issues.push("exports must be an object mapping capability ids to package exports");
  } else {
    for (const [id, entry] of Object.entries(declaration.exports as Record<string, unknown>)) {
      if (!/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/.test(id)) issues.push(`invalid capability id: ${id}`);
      if (typeof entry === "string") {
        validateModulePath(id, entry, issues);
        continue;
      }
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        issues.push(`export ${id} must be a module path or descriptor`);
        continue;
      }
      const descriptor = entry as Record<string, unknown>;
      validateModulePath(id, descriptor.module, issues);
      const manifestIssues = validateManifest(descriptor.manifest);
      issues.push(...manifestIssues.map((issue) => `${id}: ${issue}`));
      if (descriptor.manifest && typeof descriptor.manifest === "object") {
        const manifest = descriptor.manifest as Record<string, unknown>;
        if (manifest.id !== id) issues.push(`${id}: manifest id must equal export id`);
      }
      if (descriptor.integrity !== undefined && typeof descriptor.integrity !== "string") {
        issues.push(`${id}: integrity must be a string`);
      }
    }
  }
  return issues;
}

export function assertPackageDeclaration(value: unknown): asserts value is CapabilityPackageDeclaration {
  const issues = validatePackageDeclaration(value);
  if (issues.length) throw new CapabilityError("INVALID_PACKAGE_DECLARATION", issues.join("; "), issues);
}

export function createPackageDeclaration(exports: Record<string, CapabilityPackageExport>): CapabilityPackageDeclaration {
  const declaration: CapabilityPackageDeclaration = { specVersion: CAPABILITY_SPEC_VERSION, exports };
  assertPackageDeclaration(declaration);
  return Object.freeze({ ...declaration, exports: Object.freeze({ ...exports }) });
}

/** Returns only manifests embedded in package metadata. It never imports executable modules. */
export function inspectPackageDeclaration(declaration: CapabilityPackageDeclaration): Readonly<CapabilityManifest>[] {
  assertPackageDeclaration(declaration);
  const manifests: Readonly<CapabilityManifest>[] = [];
  for (const entry of Object.values(declaration.exports)) {
    if (typeof entry !== "string") {
      assertValidManifest(entry.manifest);
      manifests.push(deepFreeze({ ...entry.manifest }) as Readonly<CapabilityManifest>);
    }
  }
  return manifests;
}
