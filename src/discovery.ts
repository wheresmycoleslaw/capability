import type { CapabilityManifest, DiscoveryRanker } from "./types.js";

export type Embedder = (text: string) => readonly number[] | Promise<readonly number[]>;

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0, bv = b[i] ?? 0;
    dot += av * bv; aa += av * av; bb += bv * bv;
  }
  if (aa === 0 || bb === 0) return 0;
  return dot / (Math.sqrt(aa) * Math.sqrt(bb));
}

function manifestText(manifest: Readonly<CapabilityManifest>): string {
  return [manifest.id, manifest.name, manifest.description, ...(manifest.tags ?? [])].join(" ");
}

export class EmbeddingRanker implements DiscoveryRanker {
  constructor(private readonly embed: Embedder) {}
  async score(query: string, manifests: readonly Readonly<CapabilityManifest>[]): Promise<readonly number[]> {
    const queryVector = await this.embed(query);
    const vectors = await Promise.all(manifests.map((manifest) => this.embed(manifestText(manifest))));
    return vectors.map((vector) => cosine(queryVector, vector));
  }
}
