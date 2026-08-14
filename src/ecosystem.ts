import { spawn } from "node:child_process";
import { CapabilityRuntime } from "./runtime.js";
import { permissivePolicy } from "./policy.js";
import { InProcessExecutor, type CapabilityExecutor } from "./executor.js";
import type { CapabilityPolicy, CapabilityReceipt, DiscoveryQuery, ExecutionOptions } from "./types.js";
import {
  PublicCapabilityIndex,
  fetchCapabilityIndex,
  mergeCapabilityIndexes,
  type CapabilityIndexDocument,
  type PublicIndexResult
} from "./public-index.js";
import {
  VerifiedNpmPackageInstaller,
  acquireIndexedCapability,
  type CapabilityPackageInstaller,
  type InstalledCapabilityPackage
} from "./installer.js";
import { strictNpmTrustPolicy, type CapabilityTrustAssessment, type CapabilityTrustPolicy } from "./trust.js";
import { AutoIsolatedExecutor, isDockerAvailable } from "./docker.js";
import { createCapabilityLock, type CapabilityLockfile } from "./lockfile.js";

export const DEFAULT_CAPABILITY_INDEX_URL = "https://raw.githubusercontent.com/wheresmycoleslaw/capability/main/registry/index.json";

export type CapabilityNetwork = {
  index: CapabilityIndexDocument;
  sources: readonly string[];
};

export type FetchCapabilityNetworkOptions = {
  fetch?: typeof fetch;
  maxDepth?: number;
  maxIndexes?: number;
};

export async function fetchCapabilityNetwork(
  roots: readonly string[] = [DEFAULT_CAPABILITY_INDEX_URL],
  options: FetchCapabilityNetworkOptions = {}
): Promise<CapabilityNetwork> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new TypeError("A fetch implementation is required");
  const maxDepth = options.maxDepth ?? 4;
  const maxIndexes = options.maxIndexes ?? 64;
  const queue = roots.map((url) => ({ url, depth: 0 }));
  const seen = new Set<string>();
  const documents: CapabilityIndexDocument[] = [];
  const sources: string[] = [];
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next.url)) continue;
    if (seen.size >= maxIndexes) throw new Error(`Capability federation exceeded ${maxIndexes} indexes`);
    seen.add(next.url);
    const document = await fetchCapabilityIndex(next.url, fetchImpl);
    documents.push(document);
    sources.push(next.url);
    if (next.depth < maxDepth) {
      for (const federate of document.federates ?? []) {
        const resolved = new URL(federate, next.url).href;
        if (!seen.has(resolved)) queue.push({ url: resolved, depth: next.depth + 1 });
      }
    }
  }
  if (!documents.length) throw new Error("No capability indexes were loaded");
  return { index: mergeCapabilityIndexes(...documents), sources };
}

function semverParts(version: string): [number, number, number, string] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/.exec(version);
  if (!match) return [0, 0, 0, version];
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ""];
}

function compareVersions(a: string, b: string): number {
  const av = semverParts(a), bv = semverParts(b);
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return (bv[i] as number) - (av[i] as number);
  if (av[3] === bv[3]) return 0;
  if (!av[3]) return -1;
  if (!bv[3]) return 1;
  return av[3].localeCompare(bv[3]);
}

export function resolveIndexedCapability(index: CapabilityIndexDocument, queryOrId: string): PublicIndexResult {
  const exact: PublicIndexResult[] = [];
  for (const pkg of index.packages) {
    for (const capability of pkg.capabilities) {
      if (capability.manifest.id === queryOrId) exact.push({ package: pkg, capability, score: Number.MAX_SAFE_INTEGER, reasons: ["exact-id"] });
    }
  }
  if (exact.length) return exact.sort((a, b) => compareVersions(a.capability.manifest.version, b.capability.manifest.version) || compareVersions(a.package.version, b.package.version))[0]!;
  const matches = new PublicCapabilityIndex(index).discover({ text: queryOrId, limit: 20 });
  if (!matches.length) throw new Error(`No capability matched: ${queryOrId}`);
  return matches.sort((a, b) => b.score - a.score || compareVersions(a.capability.manifest.version, b.capability.manifest.version) || compareVersions(a.package.version, b.package.version))[0]!;
}

export type CapabilityHubOptions = {
  indexes?: readonly string[];
  fetch?: typeof fetch;
  installer?: CapabilityPackageInstaller;
  trust?: CapabilityTrustPolicy;
  policy?: CapabilityPolicy;
  executor?: CapabilityExecutor;
  loadCode?: boolean;
  maxDepth?: number;
  maxIndexes?: number;
};

export type HubAcquisition = {
  selection: PublicIndexResult;
  installed: InstalledCapabilityPackage;
  trust: CapabilityTrustAssessment;
  capability: Awaited<ReturnType<typeof acquireIndexedCapability>>["capability"];
};

export type HubExecution = HubAcquisition & { receipt: CapabilityReceipt };

export class CapabilityHub {
  readonly indexes: readonly string[];
  private readonly fetchImpl?: typeof fetch;
  private readonly installer: CapabilityPackageInstaller;
  private readonly trust: CapabilityTrustPolicy;
  private readonly policy: CapabilityPolicy;
  private readonly executor: CapabilityExecutor;
  private readonly loadCode: boolean;
  private readonly maxDepth?: number;
  private readonly maxIndexes?: number;
  private network?: CapabilityNetwork;

  constructor(options: CapabilityHubOptions = {}) {
    this.indexes = options.indexes?.length ? [...options.indexes] : [DEFAULT_CAPABILITY_INDEX_URL];
    this.fetchImpl = options.fetch;
    this.installer = options.installer ?? new VerifiedNpmPackageInstaller();
    this.trust = options.trust ?? strictNpmTrustPolicy;
    this.policy = options.policy ?? permissivePolicy;
    this.executor = options.executor ?? new AutoIsolatedExecutor();
    this.loadCode = options.loadCode ?? false;
    this.maxDepth = options.maxDepth;
    this.maxIndexes = options.maxIndexes;
    if (this.loadCode && !(this.executor instanceof InProcessExecutor)) {
      throw new TypeError("loadCode=true is reserved for explicit in-process execution");
    }
  }

  async refresh(): Promise<CapabilityNetwork> {
    this.network = await fetchCapabilityNetwork(this.indexes, {
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
      ...(this.maxDepth !== undefined ? { maxDepth: this.maxDepth } : {}),
      ...(this.maxIndexes !== undefined ? { maxIndexes: this.maxIndexes } : {})
    });
    return this.network;
  }

  async snapshot(): Promise<CapabilityNetwork> { return this.network ?? this.refresh(); }

  async discover(query: DiscoveryQuery | string): Promise<PublicIndexResult[]> {
    const network = await this.snapshot();
    return new PublicCapabilityIndex(network.index).discover(query);
  }

  async resolve(queryOrId: string): Promise<PublicIndexResult> {
    const network = await this.snapshot();
    return resolveIndexedCapability(network.index, queryOrId);
  }

  async acquire(queryOrId: string): Promise<HubAcquisition> {
    const selection = await this.resolve(queryOrId);
    const acquired = await acquireIndexedCapability(selection, { installer: this.installer, trust: this.trust, loadCode: this.loadCode });
    return { selection, ...acquired };
  }

  async createLock(queryOrId: string): Promise<CapabilityLockfile> {
    const network = await this.snapshot();
    const acquired = await this.acquire(queryOrId);
    return createCapabilityLock(acquired.selection, this.indexes[0]!, network.index, acquired.installed);
  }

  async run(queryOrId: string, input: unknown, options: ExecutionOptions = {}): Promise<HubExecution> {
    const acquired = await this.acquire(queryOrId);
    const runtime = new CapabilityRuntime({ policy: this.policy, executor: this.executor }).register(acquired.capability);
    const receipt = await runtime.invoke(acquired.capability.manifest.id, input, options);
    return { ...acquired, receipt };
  }
}

function commandAvailable(command: string, args: readonly string[], timeoutMs = 5_000): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, [...args], { stdio: "ignore" });
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolvePromise(false); }, timeoutMs);
    child.on("error", () => { clearTimeout(timer); resolvePromise(false); });
    child.on("close", (code) => { clearTimeout(timer); resolvePromise(code === 0); });
  });
}

export async function capabilityDoctor(options: { index?: string; fetch?: typeof fetch } = {}) {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  const npmAvailable = await commandAvailable(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"]);
  const dockerAvailable = await isDockerAvailable();
  let indexReachable = false;
  let indexError: string | undefined;
  try { await fetchCapabilityIndex(options.index ?? DEFAULT_CAPABILITY_INDEX_URL, options.fetch ?? globalThis.fetch); indexReachable = true; }
  catch (error) { indexError = error instanceof Error ? error.message : String(error); }
  return {
    ok: nodeMajor >= 20 && npmAvailable && indexReachable && (dockerAvailable || nodeMajor >= 25),
    node: process.versions.node,
    npmAvailable,
    dockerAvailable,
    nodePermissionNetworkIsolation: nodeMajor >= 25,
    index: options.index ?? DEFAULT_CAPABILITY_INDEX_URL,
    indexReachable,
    ...(indexError ? { indexError } : {})
  };
}
