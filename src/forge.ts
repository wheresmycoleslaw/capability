import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { inspectModuleBackedCapability } from "./acquire.js";
import { createNpmCliBridgeDescriptor, scaffoldNpmCliBridgeProject } from "./bridge.js";
import { DockerExecutor, isDockerAvailable } from "./docker.js";
import { CapabilityHub, DEFAULT_CAPABILITY_INDEX_URL } from "./ecosystem.js";
import { discoverSoftwareWorld, inspectNpmPackage, type NpmPackageInspection } from "./external-discovery.js";
import { permissivePolicy } from "./policy.js";
import { mineGitHubRepository, type RepositoryCapabilityCandidate, type RepositoryMiningReport } from "./repository-mine.js";
import { CapabilityRuntime } from "./runtime.js";
import { scaffoldCapabilityProject } from "./scaffold.js";
import type { CapabilityEffect, CapabilityReceipt, JsonValue } from "./types.js";
import { sha256 } from "./utils.js";

export const CAPABILITY_FORGE_VERSION = "0.1" as const;
export const CAPABILITY_FORGE_RUNTIME_VERSION = "^0.8.1" as const;

export type ForgeBindingKind = "npm-cli" | "npm-export";
export type ForgeSourceBinding = "verified-git-head" | "unverified-source-artifact-link";

export type ForgeDescriptor = {
  forgeVersion: typeof CAPABILITY_FORGE_VERSION;
  createdAt: string;
  repository: { fullName: string; url: string; commit: string };
  evidence: {
    candidateId: string;
    sourcePath: string;
    line?: number;
    symbol?: string;
    confidence: RepositoryCapabilityCandidate["confidence"];
    evidenceHash: string;
  };
  artifact: {
    registry: "npm";
    package: string;
    version: string;
    integrity?: string;
    gitHead?: string;
    sourceBinding: ForgeSourceBinding;
  };
  binding: {
    kind: ForgeBindingKind;
    capabilityId: string;
    exportName?: string;
    bin?: string;
  };
  authority: {
    complete: false;
    inferredEffects: readonly CapabilityEffect[];
    note: string;
  };
};

export type ForgeGitHubOptions = {
  query?: string;
  ref?: string;
  candidateId?: string;
  symbol?: string;
  packageVersion?: string;
  capabilityId?: string;
  directory?: string;
  maxFiles?: number;
  maxCandidates?: number;
  allowUnverifiedSource?: boolean;
  force?: boolean;
  fetch?: typeof fetch;
  githubToken?: string;
};

export type ForgedAbility = {
  descriptor: ForgeDescriptor;
  project: {
    directory: string;
    packageName: string;
    capabilityId: string;
    files: readonly string[];
  };
  candidate: RepositoryCapabilityCandidate;
  mining: {
    commit: string;
    coverage: RepositoryMiningReport["coverage"];
    hazards: readonly string[];
  };
};

export type SolveIntentOptions = {
  indexes?: readonly string[];
  limit?: number;
  input?: unknown;
  approved?: boolean;
  externalOnly?: boolean;
  directory?: string;
  maxForgeAttempts?: number;
  allowUnverifiedSource?: boolean;
  fetch?: typeof fetch;
  githubToken?: string;
};

export type SolveIntentResult = {
  query: string;
  route: "native" | "forged" | "unresolved";
  discovery: Awaited<ReturnType<typeof discoverSoftwareWorld>>;
  native?: { id: string; package: string; receipt?: CapabilityReceipt };
  forged?: ForgedAbility & { receipt?: CapabilityReceipt };
  attempts: readonly { repository: string; ok: boolean; reason?: string }[];
};

function slug(value: string): string {
  return value.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "ability";
}

function uniqueEffects(values: readonly CapabilityEffect[]): CapabilityEffect[] {
  return [...new Set(values)];
}

function repositoryTail(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.replace(/^git\+/, "").replace(/\.git$/, "").replace(/\/$/, "").match(/github\.com[/:]([^/]+\/[^/]+)$/i)?.[1]?.toLowerCase();
}

function chooseCandidate(report: RepositoryMiningReport, options: ForgeGitHubOptions): RepositoryCapabilityCandidate {
  let candidates = report.candidates.filter((candidate) => ["cli", "function", "library-export"].includes(candidate.kind));
  if (options.candidateId) candidates = candidates.filter((candidate) => candidate.candidateId === options.candidateId);
  if (options.symbol) candidates = candidates.filter((candidate) => candidate.symbol === options.symbol || candidate.name === options.symbol);
  const candidate = candidates[0];
  if (!candidate) {
    const detail = options.candidateId ? `candidate ${options.candidateId}` : options.symbol ? `symbol ${options.symbol}` : "a forgeable public function or CLI";
    throw new Error(`Could not find ${detail} in ${report.repository.fullName}@${report.repository.commit.slice(0, 12)}`);
  }
  if (candidate.kind !== "cli" && candidate.language !== "JavaScript" && candidate.language !== "TypeScript") {
    throw new Error(`Automatic function forging currently supports JavaScript/TypeScript package exports; ${candidate.name} is ${candidate.language ?? "an unknown language"}. The miner can still describe it, but a language binder is required before execution.`);
  }
  return candidate;
}

async function inspectPublishedArtifact(report: RepositoryMiningReport, options: ForgeGitHubOptions): Promise<NpmPackageInspection> {
  const hint = report.packageHints.npm;
  if (!hint?.name) throw new Error(`${report.repository.fullName} does not expose an npm package hint, so Capability cannot yet bind its source evidence to an exact installable artifact automatically.`);
  const requested = options.packageVersion ?? hint.version;
  if (requested) {
    try { return await inspectNpmPackage(hint.name, requested, { fetch: options.fetch }); }
    catch (error) {
      if (options.packageVersion) throw error;
    }
  }
  return inspectNpmPackage(hint.name, undefined, { fetch: options.fetch });
}

function exportName(candidate: RepositoryCapabilityCandidate): string {
  if (candidate.signature?.includes("export default")) return "default";
  if (!candidate.symbol) throw new Error(`Candidate ${candidate.candidateId} has no callable symbol`);
  return candidate.symbol;
}

function forgeManifest(report: RepositoryMiningReport, candidate: RepositoryCapabilityCandidate, artifact: NpmPackageInspection, id?: string) {
  const effects = uniqueEffects([
    ...candidate.effects.map((entry) => entry.effect),
    "custom:external.opaque-effects" as const
  ]);
  const capabilityId = id ?? `forged/${slug(report.repository.fullName)}/${slug(candidate.symbol ?? candidate.name)}`;
  return {
    specVersion: "0.1" as const,
    id: capabilityId,
    version: "1.0.0",
    name: `${candidate.name} — forged`,
    description: `Capability Forge binding for ${candidate.name} from ${report.repository.fullName}, pinned to ${artifact.name}@${artifact.version}.`,
    input: {
      type: "object",
      properties: { args: { type: "array", items: {} } },
      required: ["args"]
    },
    output: {
      type: "object",
      properties: { result: {} },
      required: ["result"]
    },
    effects,
    behavior: { deterministic: false, idempotent: false, reversible: false },
    tags: ["forged", "external", "github", "npm", "runtime-acquired"],
    metadata: {
      forged: true,
      forgeVersion: CAPABILITY_FORGE_VERSION,
      upstreamRepository: report.repository.url,
      upstreamCommit: report.repository.commit,
      upstreamPackage: artifact.name,
      upstreamVersion: artifact.version,
      sourceCandidate: candidate.candidateId,
      authorityComplete: false
    }
  };
}

function exportBridgeSource(packageName: string, name: string, manifest: ReturnType<typeof forgeManifest>): string {
  return `import { defineCapability } from "@wheresmycoleslaw/capability";\n\ntype Input = { args: unknown[] };\ntype Output = { result: unknown };\n\nconst packageName = ${JSON.stringify(packageName)};\nconst exportName = ${JSON.stringify(name)};\n\nasync function callable(): Promise<(...args: unknown[]) => unknown> {\n  // The package is pinned in package.json. Dynamic import keeps the generated binder independent of upstream TypeScript declarations.\n  // @ts-ignore -- arbitrary external packages are not required to ship declarations.\n  const upstream = await import(packageName) as Record<string, unknown>;\n  const target = exportName === "default" ? upstream.default : upstream[exportName];\n  if (typeof target !== "function") {\n    const available = Object.keys(upstream).sort().slice(0, 30).join(", ");\n    throw new Error(\`Forged export \${exportName} is not callable from \${packageName}. Available exports: \${available}\`);\n  }\n  return target as (...args: unknown[]) => unknown;\n}\n\nexport default defineCapability<Input, Output>({\n  manifest: ${JSON.stringify(manifest, null, 2)},\n  async execute(input: Input) {\n    const fn = await callable();\n    const value = await fn(...input.args);\n    const normalized = value === undefined ? null : value;\n    try { JSON.stringify(normalized); }\n    catch { throw new Error("Forged function returned a non-JSON-serializable value; a typed binder is required for this operation."); }\n    return { result: normalized };\n  },\n  verify(output: Output) {\n    try { JSON.stringify(output.result); return { ok: true, message: "forged output is JSON-serializable" }; }\n    catch { return { ok: false, message: "forged output is not JSON-serializable" }; }\n  }\n});\n`;
}

async function scaffoldNpmExportForge(
  report: RepositoryMiningReport,
  candidate: RepositoryCapabilityCandidate,
  artifact: NpmPackageInspection,
  directory: string,
  options: ForgeGitHubOptions
) {
  const manifest = forgeManifest(report, candidate, artifact, options.capabilityId);
  const packageName = `cap-forged-${slug(report.repository.fullName)}-${slug(candidate.symbol ?? candidate.name)}`;
  const base = await scaffoldCapabilityProject({
    directory,
    packageName,
    capabilityId: manifest.id,
    description: manifest.description,
    force: options.force
  });
  const root = resolve(base.directory);
  const packagePath = join(root, "package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8")) as Record<string, any>;
  pkg.version = "0.0.0-forged";
  pkg.private = true;
  pkg.dependencies = {
    "@wheresmycoleslaw/capability": CAPABILITY_FORGE_RUNTIME_VERSION,
    [artifact.name]: artifact.version
  };
  pkg.files = [...new Set([...(Array.isArray(pkg.files) ? pkg.files : []), "capability.forge.json"])];
  pkg.keywords = [...new Set([...(Array.isArray(pkg.keywords) ? pkg.keywords : []), "capability", "forge", "runtime-acquired", "github", "npm"] )];
  pkg.capability.exports[manifest.id].manifest = manifest;
  delete pkg.publishConfig;
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  await writeFile(join(root, "src/index.ts"), exportBridgeSource(artifact.name, exportName(candidate), manifest), "utf8");
  await writeFile(join(root, "test/capability.test.mjs"), `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\n\ntest("forged contract is inert and pinned", async () => {\n  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));\n  const manifest = pkg.capability.exports[${JSON.stringify(manifest.id)}].manifest;\n  assert.equal(manifest.metadata.forged, true);\n  assert.equal(pkg.dependencies[${JSON.stringify(artifact.name)}], ${JSON.stringify(artifact.version)});\n  assert.ok(manifest.effects.includes("custom:external.opaque-effects"));\n});\n`, "utf8");
  return { directory: root, packageName: base.packageName, capabilityId: manifest.id, files: [...new Set([...base.files, "capability.forge.json"])].sort() };
}

function descriptorFor(
  report: RepositoryMiningReport,
  candidate: RepositoryCapabilityCandidate,
  artifact: NpmPackageInspection,
  binding: { kind: ForgeBindingKind; capabilityId: string; exportName?: string; bin?: string },
  sourceBinding: ForgeSourceBinding
): ForgeDescriptor {
  return {
    forgeVersion: CAPABILITY_FORGE_VERSION,
    createdAt: new Date().toISOString(),
    repository: { fullName: report.repository.fullName, url: report.repository.url, commit: report.repository.commit },
    evidence: {
      candidateId: candidate.candidateId,
      sourcePath: candidate.sourcePath,
      ...(candidate.line ? { line: candidate.line } : {}),
      ...(candidate.symbol ? { symbol: candidate.symbol } : {}),
      confidence: candidate.confidence,
      evidenceHash: sha256(candidate.evidence)
    },
    artifact: {
      registry: "npm",
      package: artifact.name,
      version: artifact.version,
      ...(artifact.integrity ? { integrity: artifact.integrity } : {}),
      ...(artifact.gitHead ? { gitHead: artifact.gitHead } : {}),
      sourceBinding
    },
    binding,
    authority: {
      complete: false,
      inferredEffects: candidate.effects.map((entry) => entry.effect),
      note: "The forged operation is executable, but its authority remains intentionally incomplete. custom:external.opaque-effects requires explicit approval; sandboxing remains mandatory."
    }
  };
}

export async function forgeGitHubAbility(locator: string, options: ForgeGitHubOptions = {}): Promise<ForgedAbility> {
  const initial = await mineGitHubRepository(locator, {
    fetch: options.fetch,
    githubToken: options.githubToken,
    ref: options.ref,
    query: options.query,
    maxFiles: options.maxFiles,
    maxCandidates: options.maxCandidates
  });
  const artifact = await inspectPublishedArtifact(initial, options);
  const expectedRepo = initial.repository.fullName.toLowerCase();
  const artifactRepo = repositoryTail(artifact.repository);
  if (artifactRepo && artifactRepo !== expectedRepo) throw new Error(`npm artifact ${artifact.name}@${artifact.version} points to ${artifactRepo}, not ${expectedRepo}; refusing to forge across a repository identity mismatch.`);

  let report = initial;
  let sourceBinding: ForgeSourceBinding = "unverified-source-artifact-link";
  if (artifact.gitHead) {
    report = await mineGitHubRepository(locator, {
      fetch: options.fetch,
      githubToken: options.githubToken,
      ref: artifact.gitHead,
      query: options.query,
      maxFiles: options.maxFiles,
      maxCandidates: options.maxCandidates
    });
    if (report.repository.commit !== artifact.gitHead) throw new Error(`Could not bind npm gitHead ${artifact.gitHead} to the mined repository commit.`);
    sourceBinding = "verified-git-head";
  } else if (!options.allowUnverifiedSource) {
    throw new Error(`${artifact.name}@${artifact.version} does not expose npm gitHead metadata. Capability mined the repository but cannot prove that the published artifact came from that exact commit. Re-run with allowUnverifiedSource only if you accept that weaker source binding.`);
  }

  const candidate = chooseCandidate(report, options);
  let directory: string;
  if (options.directory) {
    directory = resolve(options.directory);
  } else {
    directory = resolve(await mkdtemp(join(tmpdir(), "capability-forge-")));
    // mkdtemp intentionally creates 0700 directories. Docker first-run executes as a non-root UID,
    // so the generated package root must be traversable without making its files writable.
    await chmod(directory, 0o755);
  }
  let project: ForgedAbility["project"];
  let binding: ForgeDescriptor["binding"];

  if (candidate.kind === "cli") {
    const bin = candidate.symbol;
    if (!bin || !artifact.bins[bin]) throw new Error(`Mined CLI ${candidate.name} is not published as a bin by ${artifact.name}@${artifact.version}.`);
    const bridge = createNpmCliBridgeDescriptor(artifact, {
      id: options.capabilityId ?? `forged/${slug(report.repository.fullName)}/${slug(bin)}`,
      bin,
      effects: candidate.effects.map((entry) => entry.effect),
      effectsComplete: false,
      tags: ["forged", "github", "runtime-acquired"]
    });
    const result = await scaffoldNpmCliBridgeProject(bridge, { directory, force: options.force });
    project = { directory: result.directory, packageName: result.packageName, capabilityId: result.capabilityId, files: result.files };
    binding = { kind: "npm-cli", capabilityId: result.capabilityId, bin };
  } else {
    project = await scaffoldNpmExportForge(report, candidate, artifact, directory, options);
    binding = { kind: "npm-export", capabilityId: project.capabilityId, exportName: exportName(candidate) };
  }

  const descriptor = descriptorFor(report, candidate, artifact, binding, sourceBinding);
  await writeFile(join(project.directory, "capability.forge.json"), `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  return {
    descriptor,
    project,
    candidate,
    mining: { commit: report.repository.commit, coverage: report.coverage, hazards: report.hazards }
  };
}

function runCommand(command: string, args: readonly string[], cwd: string, timeoutMs = 180_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} ${args.join(" ")} timed out`)); }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(stderr || stdout || `${command} exited with ${code}`));
    });
  });
}

export async function activateForgedAbility(forged: ForgedAbility, input: unknown, options: { approved?: boolean; dockerCommand?: string } = {}): Promise<CapabilityReceipt> {
  if (!options.approved) throw new Error("Forged abilities retain opaque external authority and require explicit approval before first execution.");
  if (!await isDockerAvailable(options.dockerCommand)) throw new Error("Capability Forge requires Docker for first execution of inferred external software. Refusing to fall back to in-process execution.");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await runCommand(npm, ["install", "--ignore-scripts", "--audit=false", "--fund=false"], forged.project.directory);
  await runCommand(npm, ["run", "build"], forged.project.directory);
  const packageJsonPath = join(forged.project.directory, "package.json");
  const capability = await inspectModuleBackedCapability(packageJsonPath, forged.project.capabilityId);
  const runtime = new CapabilityRuntime({
    policy: permissivePolicy,
    executor: new DockerExecutor({ dockerCommand: options.dockerCommand })
  }).register(capability);
  return runtime.invoke(forged.project.capabilityId, input, {
    approved: true,
    metadata: {
      forgeVersion: CAPABILITY_FORGE_VERSION,
      forgedFrom: forged.descriptor.repository.url,
      forgedCommit: forged.descriptor.repository.commit,
      evidenceHash: forged.descriptor.evidence.evidenceHash,
      sourceBinding: forged.descriptor.artifact.sourceBinding
    }
  });
}

export async function solveSoftwareIntent(query: string, options: SolveIntentOptions = {}): Promise<SolveIntentResult> {
  const indexes = options.indexes?.length ? options.indexes : [DEFAULT_CAPABILITY_INDEX_URL];
  const discovery = await discoverSoftwareWorld(query, {
    indexes,
    limit: options.limit ?? 8,
    fetch: options.fetch,
    githubToken: options.githubToken
  });
  const attempts: Array<{ repository: string; ok: boolean; reason?: string }> = [];

  if (!options.externalOnly && discovery.native[0]) {
    const top = discovery.native[0];
    let receipt: CapabilityReceipt | undefined;
    if (options.input !== undefined) {
      const hub = new CapabilityHub({ indexes });
      const execution = await hub.run(top.id, options.input, { approved: options.approved === true });
      receipt = execution.receipt;
    }
    return {
      query,
      route: "native",
      discovery,
      native: { id: top.id, package: top.package, ...(receipt ? { receipt } : {}) },
      attempts
    };
  }

  const forgeableExternal = [...discovery.external].sort((a, b) => {
    // Forge currently binds npm-backed repositories. Prefer npm search hits over bare GitHub hits
    // so intent-first solving spends its bounded attempts on candidates with an installable artifact.
    const artifactBias = (entry: typeof a) => entry.source === "npm" ? 1 : 0;
    return artifactBias(b) - artifactBias(a) || b.score - a.score || a.sourceRank - b.sourceRank;
  });
  const repositories = [...new Set(forgeableExternal.map((entry) => entry.repository).filter((value): value is string => Boolean(value && /github\.com/i.test(value))))];
  for (const [index, repository] of repositories.slice(0, options.maxForgeAttempts ?? 6).entries()) {
    try {
      const directory = options.directory ? resolve(options.directory, `candidate-${index + 1}-${slug(basename(repository))}`) : undefined;
      const forged = await forgeGitHubAbility(repository, {
        query,
        directory,
        allowUnverifiedSource: options.allowUnverifiedSource,
        fetch: options.fetch,
        githubToken: options.githubToken
      });
      attempts.push({ repository, ok: true });
      const receipt = options.input !== undefined ? await activateForgedAbility(forged, options.input, { approved: options.approved }) : undefined;
      return { query, route: "forged", discovery, forged: { ...forged, ...(receipt ? { receipt } : {}) }, attempts };
    } catch (error) {
      attempts.push({ repository, ok: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { query, route: "unresolved", discovery, attempts };
}
