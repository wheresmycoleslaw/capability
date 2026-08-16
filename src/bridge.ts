import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateManifest } from "./manifest.js";
import { scaffoldCapabilityProject } from "./scaffold.js";
import type { CapabilityEffect, CapabilityManifest, JsonValue } from "./types.js";
import type { NpmPackageInspection } from "./external-discovery.js";

export const CAPABILITY_BRIDGE_VERSION = "0.1" as const;

export type BridgeAuthority = {
  complete: boolean;
  note?: string;
};

export type NpmCliBridgeTarget = {
  kind: "npm-cli";
  package: string;
  version: string;
  bin: string;
  binPath: string;
};

export type CapabilityBridgeDescriptor = {
  bridgeVersion: typeof CAPABILITY_BRIDGE_VERSION;
  manifest: CapabilityManifest;
  target: NpmCliBridgeTarget;
  authority: BridgeAuthority;
  source?: Readonly<Record<string, JsonValue>>;
};

export type NpmCliBridgeOptions = {
  id?: string;
  bin?: string;
  name?: string;
  description?: string;
  effects?: readonly CapabilityEffect[];
  effectsComplete?: boolean;
  tags?: readonly string[];
};

export type BridgeScaffoldOptions = {
  directory: string;
  packageName?: string;
  repository?: string;
  force?: boolean;
};

export type BridgeScaffoldResult = {
  directory: string;
  packageName: string;
  capabilityId: string;
  upstream: string;
  files: readonly string[];
};

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "external-tool";
}

function uniqueEffects(values: readonly CapabilityEffect[]): CapabilityEffect[] {
  return [...new Set(values)];
}

export function validateCapabilityBridge(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["bridge must be an object"];
  const bridge = value as Record<string, unknown>;
  const issues: string[] = [];
  if (bridge.bridgeVersion !== CAPABILITY_BRIDGE_VERSION) issues.push(`bridgeVersion must be ${CAPABILITY_BRIDGE_VERSION}`);
  issues.push(...validateManifest(bridge.manifest).map((issue) => `manifest: ${issue}`));
  const target = bridge.target && typeof bridge.target === "object" && !Array.isArray(bridge.target) ? bridge.target as Record<string, unknown> : undefined;
  if (!target) issues.push("target is required");
  else {
    if (target.kind !== "npm-cli") issues.push("target.kind must be npm-cli");
    for (const key of ["package", "version", "bin", "binPath"] as const) if (typeof target[key] !== "string" || !target[key]) issues.push(`target.${key} is required`);
  }
  const authority = bridge.authority && typeof bridge.authority === "object" && !Array.isArray(bridge.authority) ? bridge.authority as Record<string, unknown> : undefined;
  if (!authority || typeof authority.complete !== "boolean") issues.push("authority.complete must be boolean");
  const manifest = bridge.manifest as CapabilityManifest | undefined;
  const effects = manifest?.effects ?? [];
  if (!effects.includes("process.spawn")) issues.push("bridged CLI manifests must declare process.spawn");
  if (!effects.includes("environment.read")) issues.push("bridged CLI manifests must declare environment.read because child processes inherit an environment");
  if (authority?.complete === false && !effects.includes("custom:external.opaque-effects")) issues.push("incomplete bridge authority must declare custom:external.opaque-effects");
  return issues;
}

export function createNpmCliBridgeDescriptor(inspection: NpmPackageInspection, options: NpmCliBridgeOptions = {}): CapabilityBridgeDescriptor {
  const binNames = Object.keys(inspection.bins);
  const selectedBin = options.bin ?? (binNames.length === 1 ? binNames[0] : undefined);
  if (!selectedBin || !inspection.bins[selectedBin]) {
    if (!binNames.length) throw new Error(`${inspection.name}@${inspection.version} does not publish an npm bin and cannot use the npm-cli bridge`);
    throw new Error(`Select one published bin for ${inspection.name}: ${binNames.join(", ")}`);
  }
  const capabilityId = options.id ?? `npm/${slug(`${inspection.name}-${selectedBin}`)}`;
  const effectsComplete = options.effectsComplete === true;
  const effects = uniqueEffects([
    "process.spawn",
    "environment.read",
    ...(options.effects ?? []),
    ...(effectsComplete ? [] : ["custom:external.opaque-effects" as const])
  ]);
  const humanName = options.name ?? `${selectedBin} via ${inspection.name}`;
  const description = options.description ?? `Use the existing ${inspection.name}@${inspection.version} ${selectedBin} command through a thin Capability sidecar instead of rewriting the upstream project.`;
  const source: Record<string, JsonValue> = {
    registry: "npm",
    upstreamPackage: inspection.name,
    upstreamVersion: inspection.version,
    upstreamBin: selectedBin
  };
  if (inspection.repository) source.repository = inspection.repository;
  if (inspection.integrity) source.integrity = inspection.integrity;
  const descriptor: CapabilityBridgeDescriptor = {
    bridgeVersion: CAPABILITY_BRIDGE_VERSION,
    manifest: {
      specVersion: "0.1",
      id: capabilityId,
      version: "1.0.0",
      name: humanName,
      description,
      input: {
        type: "object",
        properties: {
          args: { type: "array", items: { type: "string" } },
          stdin: { type: "string" }
        }
      },
      output: {
        type: "object",
        properties: {
          stdout: { type: "string" },
          stderr: { type: "string" },
          exitCode: { type: "number" }
        },
        required: ["stdout", "stderr", "exitCode"]
      },
      effects,
      behavior: { deterministic: false, idempotent: false, reversible: false },
      tags: [...new Set(["bridge", "external", "npm", "cli", ...(options.tags ?? [])])],
      metadata: {
        bridgeKind: "npm-cli",
        upstreamPackage: inspection.name,
        upstreamVersion: inspection.version,
        upstreamBin: selectedBin,
        authorityComplete: effectsComplete
      }
    },
    target: {
      kind: "npm-cli",
      package: inspection.name,
      version: inspection.version,
      bin: selectedBin,
      binPath: inspection.bins[selectedBin]!
    },
    authority: {
      complete: effectsComplete,
      note: effectsComplete ? "Bridge author explicitly declared the complete upstream effect surface." : "Upstream effects are intentionally treated as opaque until a bridge author audits and declares them."
    },
    source
  };
  const issues = validateCapabilityBridge(descriptor);
  if (issues.length) throw new TypeError(issues.join("; "));
  return descriptor;
}

function sourceForBridge(descriptor: CapabilityBridgeDescriptor): string {
  const manifest = JSON.stringify(descriptor.manifest, null, 2);
  const packageName = JSON.stringify(descriptor.target.package);
  const binPath = JSON.stringify(descriptor.target.binPath);
  return `import { defineCapability } from "@wheresmycoleslaw/capability";\nimport { spawn } from "node:child_process";\nimport { createRequire } from "node:module";\nimport { dirname, join } from "node:path";\nimport { readFile } from "node:fs/promises";\n\ntype Input = { args?: string[]; stdin?: string };\ntype Output = { stdout: string; stderr: string; exitCode: number };\n\nconst upstreamPackage = ${packageName};\nconst upstreamBinPath = ${binPath};\nconst require = createRequire(import.meta.url);\n\nasync function findPackageRoot(): Promise<string> {\n  let current = dirname(require.resolve(upstreamPackage));\n  for (;;) {\n    try {\n      const pkg = JSON.parse(await readFile(join(current, "package.json"), "utf8"));\n      if (pkg?.name === upstreamPackage) return current;\n    } catch {}\n    const parent = dirname(current);\n    if (parent === current) break;\n    current = parent;\n  }\n  throw new Error(\`Could not locate installed package root for \${upstreamPackage}\`);\n}\n\nfunction run(command: string, commandArgs: string[], stdin?: string): Promise<Output> {\n  return new Promise((resolvePromise, reject) => {\n    const child = spawn(command, commandArgs, { stdio: ["pipe", "pipe", "pipe"] });\n    let stdout = "";\n    let stderr = "";\n    child.stdout.setEncoding("utf8");\n    child.stderr.setEncoding("utf8");\n    child.stdout.on("data", (chunk) => { stdout += String(chunk); });\n    child.stderr.on("data", (chunk) => { stderr += String(chunk); });\n    child.once("error", reject);\n    child.once("close", (code) => resolvePromise({ stdout, stderr, exitCode: code ?? -1 }));\n    child.stdin.end(stdin);\n  });\n}\n\nexport default defineCapability<Input, Output>({\n  manifest: ${manifest},\n  async execute(input) {\n    const root = await findPackageRoot();\n    const executable = join(root, upstreamBinPath);\n    const args = input.args ?? [];\n    const result = /\\.[cm]?js$/i.test(executable)\n      ? await run(process.execPath, [executable, ...args], input.stdin)\n      : await run(executable, args, input.stdin);\n    if (result.exitCode !== 0) throw new Error(\`Upstream command exited with \${result.exitCode}: \${result.stderr || result.stdout}\`);\n    return result;\n  },\n  verify(output) {\n    return { ok: output.exitCode === 0, message: output.exitCode === 0 ? "upstream command exited successfully" : \`upstream exit code \${output.exitCode}\` };\n  }\n});\n`;
}

function testForBridge(id: string, upstream: string): string {
  return `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport capability from "../dist/index.js";\n\ntest("bridge package metadata and executable manifest cannot drift", async () => {\n  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));\n  assert.deepEqual(capability.manifest, pkg.capability.exports[${JSON.stringify(id)}].manifest);\n});\n\ntest("bridge preserves upstream identity as metadata", () => {\n  assert.equal(capability.manifest.metadata.upstreamPackage, ${JSON.stringify(upstream)});\n  assert.ok(capability.manifest.effects.includes("process.spawn"));\n});\n`;
}

export async function scaffoldNpmCliBridgeProject(descriptor: CapabilityBridgeDescriptor, options: BridgeScaffoldOptions): Promise<BridgeScaffoldResult> {
  const issues = validateCapabilityBridge(descriptor);
  if (issues.length) throw new TypeError(`Invalid bridge descriptor: ${issues.join("; ")}`);
  const base = await scaffoldCapabilityProject({
    directory: options.directory,
    packageName: options.packageName,
    capabilityId: descriptor.manifest.id,
    description: descriptor.manifest.description,
    repository: options.repository,
    force: options.force
  });
  const root = resolve(base.directory);
  const packagePath = join(root, "package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8")) as Record<string, any>;
  pkg.description = descriptor.manifest.description;
  pkg.dependencies = { ...(pkg.dependencies ?? {}), [descriptor.target.package]: descriptor.target.version };
  pkg.files = [...new Set([...(Array.isArray(pkg.files) ? pkg.files : []), "capability.bridge.json"])];
  pkg.keywords = [...new Set([...(Array.isArray(pkg.keywords) ? pkg.keywords : []), "capability", "bridge", "external", "npm-cli"])];
  pkg.capability.exports[descriptor.manifest.id].manifest = descriptor.manifest;
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  await writeFile(join(root, "src/index.ts"), sourceForBridge(descriptor), "utf8");
  await writeFile(join(root, "test/capability.test.mjs"), testForBridge(descriptor.manifest.id, descriptor.target.package), "utf8");
  await writeFile(join(root, "capability.bridge.json"), `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  const existingReadme = await readFile(join(root, "README.md"), "utf8");
  const warning = descriptor.authority.complete
    ? "The bridge author marked the declared effect list complete. Keep it synchronized with upstream behavior."
    : "The upstream effect surface has not been audited. `custom:external.opaque-effects` intentionally forces explicit approval and should remain until the bridge author can defend a complete effect declaration.";
  await writeFile(join(root, "README.md"), `# ${base.packageName}\n\nThin Capability sidecar for **${descriptor.target.package}@${descriptor.target.version}**. The upstream project remains unchanged; this package only supplies the machine-readable contract and invocation boundary.\n\n> ${warning}\n\n${existingReadme.replace(/^# .*\n+/, "")}`, "utf8");
  return {
    directory: root,
    packageName: base.packageName,
    capabilityId: descriptor.manifest.id,
    upstream: `${descriptor.target.package}@${descriptor.target.version}`,
    files: [...new Set([...base.files, "capability.bridge.json"])].sort()
  };
}
