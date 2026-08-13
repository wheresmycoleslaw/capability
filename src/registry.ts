import { CapabilityError } from "./errors.js";
import type { Capability, DiscoveryQuery, DiscoveryRanker, DiscoveryResult } from "./types.js";

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, Capability>();

  register(capability: Capability): this {
    const id = capability.manifest.id;
    if (this.capabilities.has(id)) throw new CapabilityError("DUPLICATE_CAPABILITY", `Capability already registered: ${id}`);
    this.capabilities.set(id, capability);
    return this;
  }

  replace(capability: Capability): this { this.capabilities.set(capability.manifest.id, capability); return this; }
  unregister(id: string): boolean { return this.capabilities.delete(id); }
  get(id: string): Capability | undefined { return this.capabilities.get(id); }
  require(id: string): Capability {
    const capability = this.get(id);
    if (!capability) throw new CapabilityError("NOT_FOUND", `Capability not found: ${id}`);
    return capability;
  }
  list(): Capability[] { return [...this.capabilities.values()]; }

  discover(query: DiscoveryQuery | string): DiscoveryResult[] {
    const normalized: DiscoveryQuery = typeof query === "string" ? { text: query } : query;
    const queryTokens = tokens(normalized.text);
    const tagFilter = new Set(normalized.tags ?? []);
    const effectFilter = new Set(normalized.effects ?? []);
    const results: DiscoveryResult[] = [];
    for (const capability of this.capabilities.values()) {
      const manifest = capability.manifest;
      const tags = manifest.tags ?? [];
      const effects = manifest.effects ?? [];
      if (tagFilter.size && ![...tagFilter].every((tag) => tags.includes(tag))) continue;
      if (effectFilter.size && ![...effectFilter].every((effect) => effects.includes(effect))) continue;
      const idTokens = tokens(manifest.id);
      const nameTokens = tokens(manifest.name);
      const descriptionTokens = tokens(manifest.description);
      const tagTokens = tags.flatMap(tokens);
      let score = 0;
      const reasons: string[] = [];
      for (const token of queryTokens) {
        if (manifest.id.toLowerCase() === normalized.text.toLowerCase()) { score += 20; reasons.push("exact id"); }
        if (idTokens.includes(token)) { score += 6; reasons.push(`id:${token}`); }
        if (nameTokens.includes(token)) { score += 5; reasons.push(`name:${token}`); }
        if (tagTokens.includes(token)) { score += 4; reasons.push(`tag:${token}`); }
        if (descriptionTokens.includes(token)) { score += 2; reasons.push(`description:${token}`); }
      }
      if (!queryTokens.length || score > 0) results.push({ capability, score, reasons: [...new Set(reasons)] });
    }
    return results.sort((a, b) => b.score - a.score || a.capability.manifest.id.localeCompare(b.capability.manifest.id)).slice(0, normalized.limit ?? 10);
  }

  async discoverWith(ranker: DiscoveryRanker, query: DiscoveryQuery | string): Promise<DiscoveryResult[]> {
    const normalized: DiscoveryQuery = typeof query === "string" ? { text: query } : query;
    const tagFilter = new Set(normalized.tags ?? []);
    const effectFilter = new Set(normalized.effects ?? []);
    const candidates = this.list().filter((capability) => {
      const tags = capability.manifest.tags ?? [];
      const effects = capability.manifest.effects ?? [];
      return (!tagFilter.size || [...tagFilter].every((tag) => tags.includes(tag))) && (!effectFilter.size || [...effectFilter].every((effect) => effects.includes(effect)));
    });
    const scores = await ranker.score(normalized.text, candidates.map((capability) => capability.manifest));
    if (scores.length !== candidates.length) throw new TypeError("Discovery ranker returned the wrong number of scores");
    return candidates.map((capability, index) => ({ capability, score: scores[index] ?? 0, reasons: ["ranker"] }))
      .sort((a, b) => b.score - a.score || a.capability.manifest.id.localeCompare(b.capability.manifest.id))
      .slice(0, normalized.limit ?? 10);
  }
}
