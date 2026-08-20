import { CapabilityHub, DEFAULT_CAPABILITY_INDEX_URL } from "./ecosystem.js";

export type ExternalSoftwareSource = "npm" | "github";
export type ExternalAdoptionMethod = "native-capability" | "npm-cli" | "mcp" | "openapi" | "repository-mine" | "manual-adapter";

export type ExternalAdoptionHint = {
  method: ExternalAdoptionMethod;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type ExternalSoftwareCandidate = {
  kind: "external";
  source: ExternalSoftwareSource;
  locator: string;
  name: string;
  version?: string;
  description: string;
  repository?: string;
  homepage?: string;
  language?: string;
  license?: string;
  popularity?: number;
  sourceRank: number;
  score: number;
  signals: readonly string[];
  adoption: readonly ExternalAdoptionHint[];
};

export type NpmPackageInspection = {
  source: "npm";
  name: string;
  version: string;
  description: string;
  repository?: string;
  homepage?: string;
  license?: string;
  keywords: readonly string[];
  bins: Readonly<Record<string, string>>;
  capabilityDeclared: boolean;
  integrity?: string;
  shasum?: string;
  gitHead?: string;
  main?: string;
  exports?: unknown;
};

export type ExternalDiscoveryError = { source: ExternalSoftwareSource | "capability"; message: string };

export type ExternalDiscoveryOptions = {
  fetch?: typeof fetch;
  npm?: boolean;
  github?: boolean;
  githubToken?: string;
  limitPerSource?: number;
  signal?: AbortSignal;
};

export type SoftwareWorldDiscoveryOptions = ExternalDiscoveryOptions & {
  indexes?: readonly string[];
  includeNative?: boolean;
  includeExternal?: boolean;
  limit?: number;
};

export type NativeSoftwareResult = {
  kind: "capability";
  id: string;
  version: string;
  name: string;
  description: string;
  effects: readonly string[];
  package: string;
  score: number;
  reasons: readonly string[];
};

export type SoftwareWorldDiscovery = {
  query: string;
  native: readonly NativeSoftwareResult[];
  external: readonly ExternalSoftwareCandidate[];
  errors: readonly ExternalDiscoveryError[];
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeRepository(value: unknown): string | undefined {
  const object = record(value);
  const raw = typeof value === "string" ? value : typeof object?.url === "string" ? object.url : undefined;
  return raw?.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/\.git$/, "");
}

function npmBins(packageName: string, value: unknown): Record<string, string> {
  if (typeof value === "string") {
    const defaultName = packageName.split("/").pop() ?? packageName;
    return { [defaultName]: value };
  }
  const object = record(value);
  if (!object) return {};
  const result: Record<string, string> = {};
  for (const [name, path] of Object.entries(object)) if (typeof path === "string") result[name] = path;
  return result;
}

function hint(method: ExternalAdoptionMethod, confidence: ExternalAdoptionHint["confidence"], reason: string): ExternalAdoptionHint {
  return { method, confidence, reason };
}

async function jsonResponse(fetchImpl: typeof fetch, url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetchImpl(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

export async function searchNpmSoftware(query: string, options: ExternalDiscoveryOptions = {}): Promise<ExternalSoftwareCandidate[]> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new TypeError("A fetch implementation is required");
  const limit = Math.max(1, Math.min(50, options.limitPerSource ?? 10));
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`;
  const payload = record(await jsonResponse(fetchImpl, url, { headers: { accept: "application/json" }, signal: options.signal }));
  const objects = Array.isArray(payload?.objects) ? payload.objects : [];
  const results: ExternalSoftwareCandidate[] = [];
  for (const [index, item] of objects.entries()) {
    const packageRecord = record(record(item)?.package);
    if (!packageRecord || typeof packageRecord.name !== "string") continue;
    const keywords = strings(packageRecord.keywords).map((value) => value.toLowerCase());
    const links = record(packageRecord.links);
    const adoption: ExternalAdoptionHint[] = [hint("manual-adapter", "high", "Any stable executable surface can be described by a Capability sidecar without rewriting the upstream project.")];
    if (keywords.some((value) => value === "mcp" || value.includes("model-context-protocol"))) adoption.unshift(hint("mcp", "medium", "npm metadata advertises MCP-related functionality; inspect the server/tool surface before importing."));
    if (keywords.some((value) => value === "cli" || value === "command-line" || value === "commandline")) adoption.unshift(hint("npm-cli", "low", "npm metadata suggests a CLI; inspect exact package metadata to confirm published bin entries."));
    const repository = typeof links?.repository === "string" ? normalizeRepository(links.repository) : undefined;
    const homepage = typeof links?.homepage === "string" ? links.homepage : undefined;
    const description = typeof packageRecord.description === "string" ? packageRecord.description : "npm package";
    results.push({
      kind: "external",
      source: "npm",
      locator: `npm:${packageRecord.name}${typeof packageRecord.version === "string" ? `@${packageRecord.version}` : ""}`,
      name: packageRecord.name,
      ...(typeof packageRecord.version === "string" ? { version: packageRecord.version } : {}),
      description,
      ...(repository ? { repository } : {}),
      ...(homepage ? { homepage } : {}),
      sourceRank: index + 1,
      score: 1 / (index + 1),
      signals: ["npm-search", ...(keywords.slice(0, 8).map((value) => `keyword:${value}`))],
      adoption
    });
  }
  return results;
}

export async function inspectNpmPackage(name: string, version?: string, options: ExternalDiscoveryOptions = {}): Promise<NpmPackageInspection> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new TypeError("A fetch implementation is required");
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const payload = record(await jsonResponse(fetchImpl, url, { headers: { accept: "application/json" }, signal: options.signal }));
  if (!payload) throw new TypeError(`Invalid npm metadata for ${name}`);
  const tags = record(payload["dist-tags"]);
  const selectedVersion = version ?? (typeof tags?.latest === "string" ? tags.latest : undefined);
  if (!selectedVersion) throw new Error(`No version was supplied and ${name} has no latest dist-tag`);
  const versions = record(payload.versions);
  const selected = record(versions?.[selectedVersion]);
  if (!selected) throw new Error(`npm package ${name}@${selectedVersion} was not found`);
  const dist = record(selected.dist);
  const repository = normalizeRepository(selected.repository ?? payload.repository);
  const homepage = typeof selected.homepage === "string" ? selected.homepage : typeof payload.homepage === "string" ? payload.homepage : undefined;
  const description = typeof selected.description === "string" ? selected.description : typeof payload.description === "string" ? payload.description : "npm package";
  const license = typeof selected.license === "string" ? selected.license : typeof payload.license === "string" ? payload.license : undefined;
  return {
    source: "npm",
    name,
    version: selectedVersion,
    description,
    ...(repository ? { repository } : {}),
    ...(homepage ? { homepage } : {}),
    ...(license ? { license } : {}),
    keywords: strings(selected.keywords ?? payload.keywords),
    bins: npmBins(name, selected.bin),
    capabilityDeclared: Boolean(record(selected.capability)),
    ...(typeof dist?.integrity === "string" ? { integrity: dist.integrity } : {}),
    ...(typeof dist?.shasum === "string" ? { shasum: dist.shasum } : {}),
    ...(typeof selected.gitHead === "string" ? { gitHead: selected.gitHead } : {}),
    ...(typeof selected.main === "string" ? { main: selected.main } : {}),
    ...(selected.exports !== undefined ? { exports: selected.exports } : {})
  };
}

export async function searchGitHubSoftware(query: string, options: ExternalDiscoveryOptions = {}): Promise<ExternalSoftwareCandidate[]> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new TypeError("A fetch implementation is required");
  const limit = Math.max(1, Math.min(50, options.limitPerSource ?? 10));
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "capability-external-discovery" };
  const token = options.githubToken ?? (typeof process !== "undefined" ? process.env.GITHUB_TOKEN : undefined);
  if (token) headers.authorization = `Bearer ${token}`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}`;
  const payload = record(await jsonResponse(fetchImpl, url, { headers, signal: options.signal }));
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const results: ExternalSoftwareCandidate[] = [];
  for (const [index, raw] of items.entries()) {
    const item = record(raw);
    if (!item || typeof item.full_name !== "string") continue;
    const topics = strings(item.topics).map((value) => value.toLowerCase());
    const adoption: ExternalAdoptionHint[] = [hint("repository-mine", "high", "Capability can inspect the exact repository commit for exported/public abilities, evidence, confidence, and inferred authority without executing repository code."), hint("manual-adapter", "high", "Repository code can remain upstream; Capability only needs a sidecar around a stable operation or executable surface.")];
    if (topics.some((value) => value === "mcp" || value.includes("model-context-protocol"))) adoption.unshift(hint("mcp", "medium", "Repository topics suggest an MCP surface that can be imported as Capability tools."));
    if (topics.some((value) => value === "openapi" || value === "swagger")) adoption.unshift(hint("openapi", "medium", "Repository topics suggest an OpenAPI surface that Capability can import without rewriting the service."));
    const licenseRecord = record(item.license);
    const description = typeof item.description === "string" ? item.description : "GitHub repository";
    results.push({
      kind: "external",
      source: "github",
      locator: `github:${item.full_name}`,
      name: item.full_name,
      description,
      repository: typeof item.html_url === "string" ? item.html_url : `https://github.com/${item.full_name}`,
      ...(typeof item.homepage === "string" && item.homepage ? { homepage: item.homepage } : {}),
      ...(typeof item.language === "string" ? { language: item.language } : {}),
      ...(typeof licenseRecord?.spdx_id === "string" ? { license: licenseRecord.spdx_id } : {}),
      ...(typeof item.stargazers_count === "number" ? { popularity: item.stargazers_count } : {}),
      sourceRank: index + 1,
      score: 1 / (index + 1),
      signals: ["github-search", ...(typeof item.stargazers_count === "number" ? [`stars:${item.stargazers_count}`] : []), ...topics.slice(0, 8).map((value) => `topic:${value}`), ...(item.archived === true ? ["archived"] : [])],
      adoption
    });
  }
  return results;
}

const EXTERNAL_QUERY_STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "for", "in", "on", "at", "by", "with", "and", "or", "from", "into",
  "this", "that", "my", "your", "its", "please", "use", "using", "find", "need", "needs", "ability", "abilities",
  "tool", "tools", "something", "way", "can", "could", "would", "should"
]);

const EXTERNAL_GENERIC_TERMS = new Set([
  "convert", "transform", "parse", "extract", "generate", "create", "make", "build", "format", "normalize",
  "read", "write", "load", "save", "handle", "process", "text", "string", "strings", "file", "files", "document",
  "documents", "record", "records", "value", "values", "input", "output", "content"
]);

const INDIRECT_PACKAGE_TERMS = new Set([
  "plugin", "adapter", "middleware", "loader", "contrib", "eslint", "babel", "webpack", "gulp", "grunt", "koa",
  "express", "react", "vue", "angular", "node-red"
]);

function discoveryTokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/g).filter((token) => token.length > 1 && !EXTERNAL_QUERY_STOPWORDS.has(token));
}

function subjectTokens(value: string): string[] {
  const content = discoveryTokens(value);
  const focused = content.filter((token) => !EXTERNAL_GENERIC_TERMS.has(token));
  return focused.length ? focused : content;
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Build bounded focused search expressions from a natural-language outcome. */
export function planExternalSearchQueries(query: string, maxQueries = 8): string[] {
  const raw = query.trim().replace(/\s+/g, " ");
  if (!raw) return [];
  const content = discoveryTokens(raw);
  const subject = subjectTokens(raw);
  const variants: string[] = [];
  const add = (value: string) => { if (value.trim()) variants.push(value.trim()); };

  add(subject.join(" "));
  if (subject.length > 1) {
    add(subject.join(""));
    add(subject.join("-"));
  }
  for (let size = Math.min(3, subject.length); size >= 2; size--) {
    for (let i = 0; i <= subject.length - size; i++) {
      const slice = subject.slice(i, i + size);
      add(slice.join(" "));
      add(slice.join(""));
    }
  }
  if (subject.length === 1) add(subject[0]!);
  add(content.join(" "));
  add(raw);

  const seen = new Set<string>();
  const planned: string[] = [];
  for (const variant of variants) {
    const normalized = variant.trim().replace(/\s+/g, " ");
    if (normalized.length < 2) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    planned.push(normalized);
    if (planned.length >= Math.max(1, maxQueries)) break;
  }
  return planned;
}

function relevanceScore(intent: string, candidate: ExternalSoftwareCandidate, queryIndex: number, queryCount: number): number {
  const subject = subjectTokens(intent);
  const allIntentTokens = discoveryTokens(intent);
  const name = candidate.name.toLowerCase();
  const description = candidate.description.toLowerCase();
  const nameKey = normalizedKey(candidate.name);
  const subjectKey = normalizedKey(subject.join(" "));

  const subjectInName = subject.filter((token) => name.includes(token)).length;
  const subjectInDescription = subject.filter((token) => description.includes(token)).length;
  const intentInDescription = allIntentTokens.filter((token) => description.includes(token)).length;
  const nameCoverage = subject.length ? subjectInName / subject.length : 0;
  const descriptionCoverage = subject.length ? subjectInDescription / subject.length : 0;
  const intentCoverage = allIntentTokens.length ? intentInDescription / allIntentTokens.length : 0;

  let nameAffinity = nameCoverage;
  if (subjectKey && nameKey === subjectKey) nameAffinity = 1;
  else if (subjectKey && (nameKey.includes(subjectKey) || subjectKey.includes(nameKey))) nameAffinity = Math.max(nameAffinity, 0.82);

  const rank = 1 / Math.max(1, candidate.sourceRank);
  const popularity = candidate.popularity && candidate.popularity > 0 ? Math.min(1, Math.log10(candidate.popularity + 1) / 5) : 0;
  const focusWeight = queryCount > 1 ? 1 - (queryIndex / (queryCount - 1)) * 0.08 : 1;
  const intentMentionsIndirect = allIntentTokens.some((token) => INDIRECT_PACKAGE_TERMS.has(token));
  const candidateTokens = new Set(candidate.name.toLowerCase().split(/[^a-z0-9]+/g).filter(Boolean));
  const indirect = !intentMentionsIndirect && [...candidateTokens].some((token) => INDIRECT_PACKAGE_TERMS.has(token));
  const indirectPenalty = indirect ? 0.22 : 0;

  const score = (
    nameAffinity * 0.34 +
    descriptionCoverage * 0.24 +
    intentCoverage * 0.14 +
    rank * 0.20 +
    popularity * 0.08
  ) * focusWeight - indirectPenalty;
  return Math.max(0, Math.min(1, score));
}

export async function discoverExternalSoftware(query: string, options: ExternalDiscoveryOptions = {}): Promise<{ results: readonly ExternalSoftwareCandidate[]; errors: readonly ExternalDiscoveryError[] }> {
  const queries = planExternalSearchQueries(query);
  if (!queries.length) return { results: [], errors: [] };

  const timeoutSignal = options.signal ?? (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(10_000) : undefined);
  const taskOptions: ExternalDiscoveryOptions = timeoutSignal ? { ...options, signal: timeoutSignal } : options;
  const tasks: Array<{ source: ExternalSoftwareSource; query: string; queryIndex: number; promise: Promise<ExternalSoftwareCandidate[]> }> = [];

  if (options.npm !== false) {
    for (const [queryIndex, searchQuery] of queries.entries()) {
      tasks.push({ source: "npm", query: searchQuery, queryIndex, promise: searchNpmSoftware(searchQuery, taskOptions) });
    }
  }

  if (options.github !== false) {
    const token = options.githubToken ?? (typeof process !== "undefined" ? process.env.GITHUB_TOKEN : undefined);
    // GitHub's anonymous search quota is intentionally conserved. npm carries the broad query
    // fan-out; GitHub gets the most specific expression unless authenticated.
    const githubQueries = token ? queries.slice(-Math.min(3, queries.length)) : [queries[queries.length - 1]!];
    for (const searchQuery of githubQueries) {
      const queryIndex = queries.indexOf(searchQuery);
      tasks.push({ source: "github", query: searchQuery, queryIndex: queryIndex < 0 ? queries.length - 1 : queryIndex, promise: searchGitHubSoftware(searchQuery, taskOptions) });
    }
  }

  const settled = await Promise.allSettled(tasks.map((task) => task.promise));
  const merged = new Map<string, ExternalSoftwareCandidate & { hits: number }>();
  const errors: ExternalDiscoveryError[] = [];

  for (const [index, outcome] of settled.entries()) {
    const task = tasks[index];
    if (!task) continue;
    if (outcome.status === "rejected") {
      errors.push({ source: task.source, message: `[${task.query}] ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}` });
      continue;
    }
    for (const candidate of outcome.value) {
      const key = `${candidate.source}:${candidate.locator}`;
      const scored = relevanceScore(query, candidate, task.queryIndex, queries.length);
      const previous = merged.get(key);
      if (!previous) {
        merged.set(key, {
          ...candidate,
          score: scored,
          signals: [...new Set([...candidate.signals, `query:${task.query}`])],
          hits: 1
        });
        continue;
      }
      const hits = previous.hits + 1;
      merged.set(key, {
        ...previous,
        score: Math.min(1, Math.max(previous.score, scored) + Math.min(0.12, (hits - 1) * 0.025)),
        signals: [...new Set([...previous.signals, ...candidate.signals, `query:${task.query}`])],
        adoption: [...new Map([...previous.adoption, ...candidate.adoption].map((entry) => [`${entry.method}:${entry.reason}`, entry])).values()],
        hits
      });
    }
  }

  const results = [...merged.values()]
    .map(({ hits: _hits, ...candidate }) => candidate)
    .sort((a, b) => b.score - a.score || a.source.localeCompare(b.source) || a.name.localeCompare(b.name));

  return { results, errors };
}

export async function discoverSoftwareWorld(query: string, options: SoftwareWorldDiscoveryOptions = {}): Promise<SoftwareWorldDiscovery> {
  const errors: ExternalDiscoveryError[] = [];
  let native: NativeSoftwareResult[] = [];
  if (options.includeNative !== false) {
    try {
      const hub = new CapabilityHub({ indexes: options.indexes?.length ? options.indexes : [DEFAULT_CAPABILITY_INDEX_URL] });
      const matches = await hub.discover({ text: query, limit: options.limit ?? 10 });
      native = matches.map((entry) => ({
        kind: "capability",
        id: entry.capability.manifest.id,
        version: entry.capability.manifest.version,
        name: entry.capability.manifest.name,
        description: entry.capability.manifest.description,
        effects: [...(entry.capability.manifest.effects ?? [])],
        package: `${entry.package.name}@${entry.package.version}`,
        score: entry.score,
        reasons: entry.reasons
      }));
    } catch (error) {
      errors.push({ source: "capability", message: error instanceof Error ? error.message : String(error) });
    }
  }
  let external: readonly ExternalSoftwareCandidate[] = [];
  if (options.includeExternal !== false) {
    const discovered = await discoverExternalSoftware(query, options);
    external = discovered.results.slice(0, options.limit ?? Math.max(10, discovered.results.length));
    errors.push(...discovered.errors);
  }
  return { query, native, external, errors };
}
