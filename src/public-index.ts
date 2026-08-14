import type { CapabilityManifest, DiscoveryQuery, DiscoveryRanker } from "./types.js";
import type { CapabilityPackageExport } from "./package.js";
import { validateManifest } from "./manifest.js";

export const CAPABILITY_INDEX_VERSION = "0.1" as const;

export type PublicIndexCapability = { manifest: CapabilityManifest; module: string; integrity?: string };
export type PublicIndexPackage = {
  name: string;
  version: string;
  source: string;
  repository?: string;
  integrity?: string;
  capabilities: readonly PublicIndexCapability[];
};
export type CapabilityIndexDocument = {
  indexVersion: typeof CAPABILITY_INDEX_VERSION;
  generatedAt: string;
  packages: readonly PublicIndexPackage[];
  federates?: readonly string[];
  metadata?: Readonly<Record<string, string>>;
};
export type PublicIndexResult = { package: PublicIndexPackage; capability: PublicIndexCapability; score: number; reasons: readonly string[] };

function tokens(value: string): string[] { return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
function validUrl(value: string): boolean { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; } }

export function validateCapabilityIndex(value: unknown): string[] {
  if (!value || typeof value !== "object") return ["index must be an object"];
  const index = value as Record<string, unknown>;
  const issues: string[] = [];
  if (index.indexVersion !== CAPABILITY_INDEX_VERSION) issues.push(`indexVersion must be ${CAPABILITY_INDEX_VERSION}`);
  if (typeof index.generatedAt !== "string" || Number.isNaN(Date.parse(index.generatedAt))) issues.push("generatedAt must be an ISO date string");
  if (index.federates !== undefined) {
    if (!Array.isArray(index.federates)) issues.push("federates must be an array");
    else for (const [i, url] of index.federates.entries()) if (typeof url !== "string" || !validUrl(url)) issues.push(`federates[${i}] must be an http(s) URL`);
  }
  if (index.metadata !== undefined && (!index.metadata || typeof index.metadata !== "object" || Array.isArray(index.metadata))) issues.push("metadata must be an object");
  if (!Array.isArray(index.packages)) return [...issues, "packages must be an array"];
  for (const [packageIndex, pkg] of index.packages.entries()) {
    if (!pkg || typeof pkg !== "object") { issues.push(`packages[${packageIndex}] must be an object`); continue; }
    const p = pkg as Record<string, unknown>;
    if (typeof p.name !== "string" || !p.name) issues.push(`packages[${packageIndex}].name is required`);
    if (typeof p.version !== "string" || !p.version) issues.push(`packages[${packageIndex}].version is required`);
    if (typeof p.source !== "string" || !p.source) issues.push(`packages[${packageIndex}].source is required`);
    if (p.repository !== undefined && typeof p.repository !== "string") issues.push(`packages[${packageIndex}].repository must be a string`);
    if (p.integrity !== undefined && typeof p.integrity !== "string") issues.push(`packages[${packageIndex}].integrity must be a string`);
    if (!Array.isArray(p.capabilities)) { issues.push(`packages[${packageIndex}].capabilities must be an array`); continue; }
    for (const [capIndex, cap] of p.capabilities.entries()) {
      if (!cap || typeof cap !== "object") { issues.push(`packages[${packageIndex}].capabilities[${capIndex}] must be an object`); continue; }
      const c = cap as Record<string, unknown>;
      if (typeof c.module !== "string" || !c.module.startsWith("./")) issues.push(`packages[${packageIndex}].capabilities[${capIndex}].module must be package-relative`);
      if (c.integrity !== undefined && typeof c.integrity !== "string") issues.push(`packages[${packageIndex}].capabilities[${capIndex}].integrity must be a string`);
      issues.push(...validateManifest(c.manifest).map((issue) => `packages[${packageIndex}].capabilities[${capIndex}]: ${issue}`));
    }
  }
  return issues;
}

export function createCapabilityIndex(
  packages: readonly PublicIndexPackage[],
  now = new Date(),
  options: { federates?: readonly string[]; metadata?: Readonly<Record<string, string>> } = {}
): CapabilityIndexDocument {
  const document: CapabilityIndexDocument = {
    indexVersion: CAPABILITY_INDEX_VERSION,
    generatedAt: now.toISOString(),
    packages,
    ...(options.federates?.length ? { federates: [...new Set(options.federates)] } : {}),
    ...(options.metadata ? { metadata: { ...options.metadata } } : {})
  };
  const issues = validateCapabilityIndex(document);
  if (issues.length) throw new TypeError(issues.join("; "));
  return document;
}

export function mergeCapabilityIndexes(...indexes: readonly CapabilityIndexDocument[]): CapabilityIndexDocument {
  const packages = new Map<string, PublicIndexPackage>();
  const federates = new Set<string>();
  for (const index of indexes) {
    const issues = validateCapabilityIndex(index);
    if (issues.length) throw new TypeError(issues.join("; "));
    for (const pkg of index.packages) packages.set(`${pkg.name}@${pkg.version}`, pkg);
    for (const url of index.federates ?? []) federates.add(url);
  }
  return createCapabilityIndex(
    [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)),
    new Date(),
    { federates: [...federates] }
  );
}

export class PublicCapabilityIndex {
  private document: CapabilityIndexDocument;
  constructor(document: CapabilityIndexDocument = createCapabilityIndex([])) {
    const issues = validateCapabilityIndex(document);
    if (issues.length) throw new TypeError(issues.join("; "));
    this.document = document;
  }
  snapshot(): CapabilityIndexDocument { return this.document; }
  addPackage(pkg: PublicIndexPackage): this {
    const map = new Map(this.document.packages.map((item) => [`${item.name}@${item.version}`, item]));
    map.set(`${pkg.name}@${pkg.version}`, pkg);
    this.document = createCapabilityIndex([...map.values()], new Date(), { federates: this.document.federates, metadata: this.document.metadata });
    return this;
  }
  discover(query: DiscoveryQuery | string): PublicIndexResult[] {
    const normalized = typeof query === "string" ? { text: query } : query;
    const queryTokens = tokens(normalized.text);
    const results: PublicIndexResult[] = [];
    for (const pkg of this.document.packages) {
      for (const capability of pkg.capabilities) {
        const tags = capability.manifest.tags ?? [];
        const effects = capability.manifest.effects ?? [];
        if (normalized.tags?.length && !normalized.tags.every((tag) => tags.includes(tag))) continue;
        if (normalized.effects?.length && !normalized.effects.every((effect) => effects.includes(effect))) continue;
        let score = 0;
        const reasons: string[] = [];
        const id = tokens(capability.manifest.id), name = tokens(capability.manifest.name), description = tokens(capability.manifest.description), tagTokens = tags.flatMap(tokens);
        for (const token of queryTokens) {
          if (id.includes(token)) { score += 6; reasons.push(`id:${token}`); }
          if (name.includes(token)) { score += 5; reasons.push(`name:${token}`); }
          if (tagTokens.includes(token)) { score += 4; reasons.push(`tag:${token}`); }
          if (description.includes(token)) { score += 2; reasons.push(`description:${token}`); }
        }
        if (!queryTokens.length || score > 0) results.push({ package: pkg, capability, score, reasons: [...new Set(reasons)] });
      }
    }
    return results.sort((a, b) => b.score - a.score || a.capability.manifest.id.localeCompare(b.capability.manifest.id)).slice(0, normalized.limit ?? 10);
  }
  async discoverWith(ranker: DiscoveryRanker, query: DiscoveryQuery | string): Promise<PublicIndexResult[]> {
    const normalized = typeof query === "string" ? { text: query } : query;
    const candidates = this.discover({ ...normalized, text: "", limit: Number.MAX_SAFE_INTEGER });
    const scores = await ranker.score(normalized.text, candidates.map((entry) => entry.capability.manifest));
    if (scores.length !== candidates.length) throw new TypeError("Discovery ranker returned the wrong number of scores");
    return candidates.map((entry, i) => ({ ...entry, score: scores[i] ?? 0, reasons: ["ranker"] })).sort((a, b) => b.score - a.score).slice(0, normalized.limit ?? 10);
  }
}

export function packageExportsToIndexCapabilities(exports: Record<string, CapabilityPackageExport>): PublicIndexCapability[] {
  const result: PublicIndexCapability[] = [];
  for (const [id, entry] of Object.entries(exports)) {
    if (typeof entry === "string") continue;
    if (entry.manifest.id !== id) throw new TypeError(`manifest id mismatch for ${id}`);
    result.push({ manifest: entry.manifest, module: entry.module, ...(entry.integrity ? { integrity: entry.integrity } : {}) });
  }
  return result;
}

export async function fetchCapabilityIndex(url: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<CapabilityIndexDocument> {
  if (!fetchImpl) throw new TypeError("A fetch implementation is required");
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Failed to fetch capability index: HTTP ${response.status}`);
  const document = await response.json() as CapabilityIndexDocument;
  const issues = validateCapabilityIndex(document);
  if (issues.length) throw new TypeError(`Invalid capability index: ${issues.join("; ")}`);
  return document;
}
