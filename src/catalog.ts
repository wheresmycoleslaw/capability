import type { Capability, CapabilityManifest, DiscoveryQuery, DiscoveryRanker } from "./types.js";
import { inspectCapabilityPackage, loadCapabilityFromPackage } from "./acquire.js";
import { CapabilityError } from "./errors.js";

export type CapabilityLocator = { packageJsonPath: string; module: string; packageName?: string; packageVersion?: string; integrity?: string };
export type IndexedCapability = { manifest: Readonly<CapabilityManifest>; locator: Readonly<CapabilityLocator> };
export type CatalogResult = IndexedCapability & { score: number; reasons: readonly string[] };

function tokens(value: string): string[] { return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
function passesFilters(entry: IndexedCapability, query: DiscoveryQuery): boolean {
  const tags = entry.manifest.tags ?? [];
  const effects = entry.manifest.effects ?? [];
  return (!(query.tags?.length) || query.tags.every((tag) => tags.includes(tag))) && (!(query.effects?.length) || query.effects.every((effect) => effects.includes(effect)));
}

export class CapabilityCatalog {
  private readonly entries = new Map<string, IndexedCapability>();
  add(manifest: Readonly<CapabilityManifest>, locator: CapabilityLocator): this {
    this.entries.set(manifest.id, Object.freeze({ manifest, locator: Object.freeze({ ...locator }) }));
    return this;
  }
  async indexPackage(packageJsonPath: string): Promise<this> {
    const inspected = await inspectCapabilityPackage(packageJsonPath);
    for (const entry of inspected.entries) {
      this.add(entry.manifest, { packageJsonPath, module: entry.module, packageName: inspected.name, packageVersion: inspected.version, ...(entry.integrity ? { integrity: entry.integrity } : {}) });
    }
    return this;
  }
  get(id: string): IndexedCapability | undefined { return this.entries.get(id); }
  list(): IndexedCapability[] { return [...this.entries.values()]; }
  discover(query: DiscoveryQuery | string): CatalogResult[] {
    const normalized: DiscoveryQuery = typeof query === "string" ? { text: query } : query;
    const queryTokens = tokens(normalized.text);
    const results: CatalogResult[] = [];
    for (const entry of this.entries.values()) {
      if (!passesFilters(entry, normalized)) continue;
      const manifest = entry.manifest;
      const idTokens = tokens(manifest.id), nameTokens = tokens(manifest.name), descTokens = tokens(manifest.description), tagTokens = (manifest.tags ?? []).flatMap(tokens);
      let score = 0;
      const reasons: string[] = [];
      for (const token of queryTokens) {
        if (manifest.id.toLowerCase() === normalized.text.toLowerCase()) { score += 20; reasons.push("exact id"); }
        if (idTokens.includes(token)) { score += 6; reasons.push(`id:${token}`); }
        if (nameTokens.includes(token)) { score += 5; reasons.push(`name:${token}`); }
        if (tagTokens.includes(token)) { score += 4; reasons.push(`tag:${token}`); }
        if (descTokens.includes(token)) { score += 2; reasons.push(`description:${token}`); }
      }
      if (!queryTokens.length || score > 0) results.push({ ...entry, score, reasons: [...new Set(reasons)] });
    }
    return results.sort((a, b) => b.score - a.score || a.manifest.id.localeCompare(b.manifest.id)).slice(0, normalized.limit ?? 10);
  }
  async discoverWith(ranker: DiscoveryRanker, query: DiscoveryQuery | string): Promise<CatalogResult[]> {
    const normalized: DiscoveryQuery = typeof query === "string" ? { text: query } : query;
    const candidates = this.list().filter((entry) => passesFilters(entry, normalized));
    const scores = await ranker.score(normalized.text, candidates.map((entry) => entry.manifest));
    if (scores.length !== candidates.length) throw new TypeError("Discovery ranker returned the wrong number of scores");
    return candidates.map((entry, index) => ({ ...entry, score: scores[index] ?? 0, reasons: ["ranker"] })).sort((a, b) => b.score - a.score || a.manifest.id.localeCompare(b.manifest.id)).slice(0, normalized.limit ?? 10);
  }
  async acquire(id: string): Promise<Capability> {
    const entry = this.get(id);
    if (!entry) throw new CapabilityError("NOT_FOUND", `Capability is not indexed: ${id}`);
    return loadCapabilityFromPackage(entry.locator.packageJsonPath, id);
  }
}
