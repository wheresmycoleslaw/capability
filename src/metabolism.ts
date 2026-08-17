import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { CapabilityHub, DEFAULT_CAPABILITY_INDEX_URL } from "./ecosystem.js";
import { discoverSoftwareWorld } from "./external-discovery.js";
import { solveSoftwareIntent } from "./forge.js";
import { validateManifest } from "./manifest.js";
import { executePyPiAbility, forgePyPiAbility, inspectPyPiPackage, minePyPiArtifact } from "./pypi.js";
export { executePyPiAbility, forgePyPiAbility, inspectPyPiPackage, minePyPiArtifact } from "./pypi.js";
export type { PyPiInspection, PythonCandidate, PythonExecutionReceipt, PythonForge, PythonMiningReport } from "./pypi.js";
import type { CapabilityEffect, CapabilityManifest, CapabilityReceipt, JsonValue } from "./types.js";

export const CAPABILITY_METABOLISM_VERSION = "0.1" as const;

export type MetabolicSubstrate = "native" | "npm" | "pypi" | "oci" | "mcp" | "openapi" | "repository" | "composition" | "gap";
export type MetabolicCoverageEntry = {
  substrate: MetabolicSubstrate;
  discovery: "automatic" | "explicit" | "derived";
  mining: "none" | "metadata" | "source" | "artifact" | "contract";
  binding: "native" | "automatic" | "explicit" | "planned" | "none";
  firstExecution: "normal" | "docker" | "container" | "external" | "none";
  notes: string;
};

export function metabolicCoverage(): { version: typeof CAPABILITY_METABOLISM_VERSION; entries: MetabolicCoverageEntry[]; principle: string } {
  return {
    version: CAPABILITY_METABOLISM_VERSION,
    principle: "Coverage is reported as concrete substrate support, never as an invented percentage of all software.",
    entries: [
      { substrate: "native", discovery: "automatic", mining: "contract", binding: "native", firstExecution: "normal", notes: "Federated inert Capability contracts." },
      { substrate: "npm", discovery: "automatic", mining: "source", binding: "automatic", firstExecution: "docker", notes: "Root-callable JavaScript/TypeScript exports and npm CLIs through Forge." },
      { substrate: "pypi", discovery: "explicit", mining: "artifact", binding: "automatic", firstExecution: "docker", notes: "Universal Python wheel functions and console scripts; exact wheel bytes are SHA256-verified, stored with the binding, and executed with no dependency/network drift." },
      { substrate: "oci", discovery: "explicit", mining: "metadata", binding: "automatic", firstExecution: "container", notes: "OCI/Docker images are pinned to an immutable RepoDigest and exposed as command capabilities." },
      { substrate: "mcp", discovery: "explicit", mining: "contract", binding: "automatic", firstExecution: "external", notes: "Existing MCP tools become Capability contracts without upstream changes." },
      { substrate: "openapi", discovery: "explicit", mining: "contract", binding: "automatic", firstExecution: "external", notes: "OpenAPI operations become Capability contracts." },
      { substrate: "repository", discovery: "automatic", mining: "source", binding: "planned", firstExecution: "none", notes: "Evidence mining spans more languages than automatic execution binders." },
      { substrate: "composition", discovery: "derived", mining: "contract", binding: "automatic", firstExecution: "normal", notes: "Schema-compatible contracts can be planned into pipelines; each step keeps its own authority boundary." },
      { substrate: "gap", discovery: "derived", mining: "contract", binding: "none", firstExecution: "none", notes: "Unresolved outcomes become machine-readable missing-capability specifications." }
    ]
  };
}

export type CapabilityGap = {
  gapVersion: "0.1";
  id: string;
  intent: string;
  createdAt: string;
  required: { input?: Record<string, unknown>; output?: Record<string, unknown>; effectsCeiling: CapabilityEffect[]; verification: string[] };
  searched: MetabolicSubstrate[];
  evidence: { nativeCandidates: string[]; externalCandidates: string[]; compositionAttempts: string[] };
  status: "unresolved";
};

function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "missing-ability"; }
export function createCapabilityGap(intent: string, options: Partial<CapabilityGap["required"]> & { searched?: MetabolicSubstrate[]; nativeCandidates?: string[]; externalCandidates?: string[]; compositionAttempts?: string[] } = {}): CapabilityGap {
  return {
    gapVersion: "0.1",
    id: `gap/${slug(intent)}`,
    intent,
    createdAt: new Date().toISOString(),
    required: {
      ...(options.input ? { input: options.input } : {}),
      ...(options.output ? { output: options.output } : {}),
      effectsCeiling: options.effectsCeiling ?? [],
      verification: options.verification ?? ["Output must satisfy the requested outcome and declared output contract."]
    },
    searched: options.searched ?? ["native", "npm", "repository", "composition"],
    evidence: {
      nativeCandidates: options.nativeCandidates ?? [],
      externalCandidates: options.externalCandidates ?? [],
      compositionAttempts: options.compositionAttempts ?? []
    },
    status: "unresolved"
  };
}

type Schema = Record<string, unknown> | undefined;
export type MetabolicCompositionStep = { id: string; name: string; description: string; input?: Schema; output?: Schema; effects: CapabilityEffect[]; score: number };
export type CompositionPlan = { intent: string; steps: MetabolicCompositionStep[]; compatible: boolean; reasons: string[]; effects: CapabilityEffect[] };

function schemaType(schema: Schema): string | undefined { return typeof schema?.type === "string" ? schema.type : undefined; }
function schemaProperties(schema: Schema): Set<string> { const raw = schema?.properties; return raw && typeof raw === "object" ? new Set(Object.keys(raw as object)) : new Set(); }
export function contractsCompose(output: Schema, input: Schema): { compatible: boolean; reason: string } {
  if (!input || !output) return { compatible: true, reason: "At least one contract is unconstrained; compatibility is possible but not proven." };
  const outType = schemaType(output), inType = schemaType(input);
  if (outType && inType && outType !== inType) return { compatible: false, reason: `Schema type mismatch: ${outType} → ${inType}` };
  if (inType === "object") {
    const required = Array.isArray(input.required) ? input.required.filter((x): x is string => typeof x === "string") : [];
    const props = schemaProperties(output);
    const missing = required.filter((key) => !props.has(key));
    if (missing.length) return { compatible: false, reason: `Producer lacks required consumer fields: ${missing.join(", ")}` };
  }
  return { compatible: true, reason: "Output contract can feed input contract without a known schema contradiction." };
}

export function planComposition(intent: string, candidates: readonly MetabolicCompositionStep[], maxDepth = 4): CompositionPlan[] {
  const plans: CompositionPlan[] = [];
  const walk = (path: MetabolicCompositionStep[]) => {
    if (path.length >= 2) {
      const reasons: string[] = [];
      let compatible = true;
      for (let i = 0; i < path.length - 1; i++) {
        const check = contractsCompose(path[i]!.output, path[i + 1]!.input);
        reasons.push(`${path[i]!.id} → ${path[i + 1]!.id}: ${check.reason}`);
        if (!check.compatible) compatible = false;
      }
      if (compatible) plans.push({ intent, steps: [...path], compatible, reasons, effects: [...new Set(path.flatMap((step) => step.effects))] });
    }
    if (path.length >= maxDepth) return;
    for (const candidate of candidates) {
      if (path.some((entry) => entry.id === candidate.id)) continue;
      if (path.length) {
        const check = contractsCompose(path[path.length - 1]!.output, candidate.input);
        if (!check.compatible) continue;
      }
      walk([...path, candidate]);
    }
  };
  for (const candidate of candidates) walk([candidate]);
  return plans.sort((a, b) => (b.steps.reduce((sum, x) => sum + x.score, 0) / b.steps.length) - (a.steps.reduce((sum, x) => sum + x.score, 0) / a.steps.length)).slice(0, 25);
}

type SpawnResult = { stdout: string; stderr: string; code: number };
function run(command: string, args: readonly string[], options: { input?: string; cwd?: string; timeoutMs?: number } = {}): Promise<SpawnResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} timed out`)); }, options.timeoutMs ?? 120_000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolvePromise({ stdout, stderr, code: code ?? -1 }); });
    child.stdin.end(options.input);
  });
}

export type OciInspection = { reference: string; immutableReference: string; repoDigests: string[]; id: string; architecture?: string; os?: string; entrypoint?: string[]; cmd?: string[] };
export async function inspectOciImage(reference: string, dockerCommand = "docker"): Promise<OciInspection> {
  const pull = await run(dockerCommand, ["pull", reference], { timeoutMs: 180_000 });
  if (pull.code !== 0) throw new Error(pull.stderr || `docker pull failed for ${reference}`);
  const inspect = await run(dockerCommand, ["image", "inspect", reference], { timeoutMs: 30_000 });
  if (inspect.code !== 0) throw new Error(inspect.stderr || `docker image inspect failed for ${reference}`);
  const raw = JSON.parse(inspect.stdout) as Array<Record<string, any>>;
  const image = raw[0]; if (!image) throw new Error(`No image metadata returned for ${reference}`);
  const repoDigests = Array.isArray(image.RepoDigests) ? image.RepoDigests.filter((x: unknown): x is string => typeof x === "string") : [];
  const immutableReference = repoDigests[0]; if (!immutableReference) throw new Error(`Image ${reference} has no immutable RepoDigest after pull`);
  return {
    reference, immutableReference, repoDigests, id: String(image.Id ?? ""),
    ...(typeof image.Architecture === "string" ? { architecture: image.Architecture } : {}),
    ...(typeof image.Os === "string" ? { os: image.Os } : {}),
    ...(Array.isArray(image.Config?.Entrypoint) ? { entrypoint: image.Config.Entrypoint } : {}),
    ...(Array.isArray(image.Config?.Cmd) ? { cmd: image.Config.Cmd } : {})
  };
}

export type OciExecutionReceipt = { substrate: "oci"; image: string; immutableReference: string; args: string[]; status: "succeeded" | "failed"; stdout: string; stderr: string; startedAt: string; finishedAt: string };
export async function executeOciImage(reference: string, args: readonly string[] = [], options: { approved?: boolean; network?: boolean; dockerCommand?: string; timeoutMs?: number } = {}): Promise<OciExecutionReceipt> {
  if (!options.approved) throw new Error("OCI first execution requires explicit approval");
  const docker = options.dockerCommand ?? "docker";
  const inspection = await inspectOciImage(reference, docker);
  const startedAt = new Date().toISOString();
  const execution = await run(docker, ["run", "--rm", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges:true", "--pids-limit=64", "--memory=512m", "--cpus=1", `--network=${options.network ? "bridge" : "none"}`, inspection.immutableReference, ...args], { timeoutMs: options.timeoutMs ?? 120_000 });
  return { substrate: "oci", image: reference, immutableReference: inspection.immutableReference, args: [...args], status: execution.code === 0 ? "succeeded" : "failed", stdout: execution.stdout, stderr: execution.stderr, startedAt, finishedAt: new Date().toISOString() };
}

export type MetabolizeResult = { intent: string; route: MetabolicSubstrate; result?: unknown; receipt?: unknown; gap?: CapabilityGap; attempts: { substrate: MetabolicSubstrate; ok: boolean; detail: string }[] };

function searchedFromAttempts(attempts: MetabolizeResult["attempts"]): MetabolicSubstrate[] {
  const searched: MetabolicSubstrate[] = ["native", "npm", "repository", "composition"];
  for (const substrate of ["pypi", "oci"] as const) if (attempts.some((attempt) => attempt.substrate === substrate)) searched.push(substrate);
  return searched;
}
export async function metabolizeIntent(intent: string, options: { input?: unknown; approved?: boolean; indexes?: readonly string[]; pythonPackage?: string; pythonVersion?: string; ociImage?: string; ociArgs?: string[]; externalOnly?: boolean; allowUnverifiedSource?: boolean } = {}): Promise<MetabolizeResult> {
  const attempts: MetabolizeResult["attempts"] = [];
  if (options.ociImage) {
    try { const receipt = await executeOciImage(options.ociImage, options.ociArgs ?? [], { approved: options.approved }); return { intent, route: "oci", receipt, attempts: [...attempts, { substrate: "oci", ok: receipt.status === "succeeded", detail: receipt.immutableReference }] }; }
    catch (error) { attempts.push({ substrate: "oci", ok: false, detail: error instanceof Error ? error.message : String(error) }); }
  }
  if (options.pythonPackage) {
    try {
      const forged = await forgePyPiAbility(options.pythonPackage, { version: options.pythonVersion, query: intent });
      const receipt = options.input !== undefined ? await executePyPiAbility(forged, options.input as { args?: unknown[]; kwargs?: Record<string, unknown> }, { approved: options.approved }) : undefined;
      return { intent, route: "pypi", result: forged, ...(receipt ? { receipt } : {}), attempts: [...attempts, { substrate: "pypi", ok: true, detail: `${forged.artifact.name}@${forged.artifact.version}:${forged.candidate.module}.${forged.candidate.symbol}` }] };
    } catch (error) { attempts.push({ substrate: "pypi", ok: false, detail: error instanceof Error ? error.message : String(error) }); }
  }
  try {
    const solved = await solveSoftwareIntent(intent, { indexes: options.indexes ?? [DEFAULT_CAPABILITY_INDEX_URL], ...(options.input !== undefined ? { input: options.input } : {}), approved: options.approved, externalOnly: options.externalOnly, allowUnverifiedSource: options.allowUnverifiedSource });
    attempts.push({ substrate: solved.route === "native" ? "native" : solved.route === "forged" ? "npm" : "repository", ok: solved.route !== "unresolved", detail: solved.route });
    if (solved.route !== "unresolved") return { intent, route: solved.route === "native" ? "native" : "npm", result: solved, receipt: solved.native?.receipt ?? solved.forged?.receipt, attempts };
    const external = solved.discovery.external.map((entry) => entry.name).slice(0, 10);
    return { intent, route: "gap", gap: createCapabilityGap(intent, { externalCandidates: external, searched: searchedFromAttempts(attempts) }), attempts };
  } catch (error) {
    attempts.push({ substrate: "npm", ok: false, detail: error instanceof Error ? error.message : String(error) });
    const discovery = await discoverSoftwareWorld(intent, { indexes: options.indexes ?? [DEFAULT_CAPABILITY_INDEX_URL], limit: 10 });
    return { intent, route: "gap", gap: createCapabilityGap(intent, { nativeCandidates: discovery.native.map((x) => x.id), externalCandidates: discovery.external.map((x) => x.name), searched: searchedFromAttempts(attempts) }), attempts };
  }
}
