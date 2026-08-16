import type { CapabilityEffect } from "./types.js";

export type RepositoryMiningConfidence = "high" | "medium" | "low";
export type RepositoryEvidenceKind = "declaration" | "documentation" | "test" | "example" | "manifest" | "route" | "effect" | "dependency";
export type RepositoryCandidateKind = "function" | "class" | "cli" | "http-operation" | "library-export";

export type RepositoryEvidence = {
  kind: RepositoryEvidenceKind;
  path: string;
  line?: number;
  detail: string;
  strength: RepositoryMiningConfidence;
};

export type RepositoryEffectInference = {
  effect: CapabilityEffect;
  confidence: RepositoryMiningConfidence;
  evidence: readonly RepositoryEvidence[];
};

export type RepositoryCapabilityCandidate = {
  kind: RepositoryCandidateKind;
  candidateId: string;
  name: string;
  description: string;
  symbol?: string;
  language?: string;
  sourcePath: string;
  line?: number;
  signature?: string;
  confidence: { score: number; level: RepositoryMiningConfidence };
  usefulnessScore: number;
  queryScore: number;
  evidence: readonly RepositoryEvidence[];
  effects: readonly RepositoryEffectInference[];
  authority: { complete: false; note: string };
  executable: false;
  draftContract: {
    specVersion: "0.1";
    id: string;
    version: "0.0.0-inferred";
    name: string;
    description: string;
    effects: readonly CapabilityEffect[];
    metadata: Record<string, unknown>;
  };
};

export type RepositoryMiningReport = {
  repository: {
    fullName: string;
    url: string;
    description?: string;
    defaultBranch: string;
    ref: string;
    commit: string;
    language?: string;
    license?: string;
    archived: boolean;
  };
  packageHints: {
    npm?: { name: string; version?: string; bins: Readonly<Record<string, string>> };
    openapiFiles: readonly string[];
    mcpSignals: readonly string[];
  };
  coverage: {
    treeTruncated: boolean;
    eligibleFiles: number;
    analyzedFiles: number;
    sourceEligible: number;
    sourceAnalyzed: number;
    sourceCoverageRatio: number;
    maxFiles: number;
    maxFileBytes: number;
  };
  candidates: readonly RepositoryCapabilityCandidate[];
  hazards: readonly string[];
  unsupportedExtensions: readonly string[];
  generatedAt: string;
};

export type RepositoryMiningOptions = {
  fetch?: typeof fetch;
  githubToken?: string;
  ref?: string;
  query?: string;
  maxFiles?: number;
  maxFileBytes?: number;
  maxCandidates?: number;
  signal?: AbortSignal;
};

type JsonObject = Record<string, unknown>;
type TreeEntry = { path: string; type: string; sha?: string; size?: number };
type LoadedFile = { path: string; content: string; size: number; role: "source" | "test" | "example" | "documentation" | "manifest" };
type SymbolFinding = { kind: RepositoryCandidateKind; name: string; symbol?: string; line: number; index: number; signature: string; description?: string; language?: string; region: string };

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".py", ".go", ".rs", ".java", ".kt", ".kts", ".cs", ".rb", ".php", ".swift"]);
const SKIP_SEGMENTS = ["node_modules/", "vendor/", "dist/", "build/", "coverage/", ".next/", "target/", "Pods/", "DerivedData/", "third_party/", "third-party/"];
const ACTION_WORDS = ["convert", "render", "generate", "parse", "extract", "analyze", "calculate", "compute", "transform", "encode", "decode", "compress", "decompress", "resize", "search", "query", "fetch", "load", "save", "write", "read", "create", "delete", "update", "send", "receive", "validate", "verify", "compile", "build", "deploy", "sync", "import", "export", "translate", "transcribe", "summarize", "classify", "detect", "route", "resolve", "format", "normalize", "hash", "sign", "encrypt", "decrypt", "merge", "split", "compare", "diff", "scan", "index"];

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extension(path: string): string {
  const match = /(?:^|\/)[^/]*(\.[A-Za-z0-9]+)$/.exec(path);
  return match?.[1]?.toLowerCase() ?? "";
}

function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (content.charCodeAt(i) === 10) line += 1;
  return line;
}

function roleForPath(path: string): LoadedFile["role"] {
  const lower = path.toLowerCase();
  if (/(^|\/)(test|tests|__tests__|spec)(\/|$)/.test(lower) || /(?:\.test|\.spec)\.[^.]+$/.test(lower)) return "test";
  if (/(^|\/)(example|examples|demo|demos|sample|samples)(\/|$)/.test(lower)) return "example";
  if (/(^|\/)(readme|contributing|docs?)(?:\.|\/|$)/.test(lower) || /\.(?:md|mdx|rst)$/i.test(path)) return "documentation";
  if (/(^|\/)(package\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|build\.gradle(?:\.kts)?|composer\.json|gemfile)$/i.test(lower)) return "manifest";
  return "source";
}

function isInteresting(path: string): boolean {
  const lower = path.toLowerCase();
  if (SKIP_SEGMENTS.some((segment) => lower.includes(segment.toLowerCase()))) return false;
  if (/\.(?:min\.js|map|lock|png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|eot|mp3|mp4|mov|wasm)$/i.test(path)) return false;
  if (SOURCE_EXTENSIONS.has(extension(path))) return true;
  return roleForPath(path) !== "source" || /(?:openapi|swagger)\.(?:json|ya?ml)$/i.test(path);
}

function pathPriority(path: string): number {
  const role = roleForPath(path);
  const lower = path.toLowerCase();
  let score = role === "manifest" ? 120 : role === "documentation" ? 105 : role === "example" ? 90 : role === "test" ? 80 : 70;
  if (/(^|\/)(src|lib|pkg|internal|cmd|app)(\/|$)/.test(lower)) score += 16;
  if (!path.includes("/")) score += 12;
  if (/index\.[^.]+$|main\.[^.]+$|mod\.rs$|lib\.rs$|__init__\.py$/i.test(path)) score += 10;
  if (/(generated|fixture|snapshot|mock)/i.test(path)) score -= 28;
  return score;
}

function parseRepositoryLocator(locator: string): { owner: string; repo: string } {
  const trimmed = locator.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const urlMatch = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i.exec(trimmed);
  const shortMatch = /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed);
  const match = urlMatch ?? shortMatch;
  if (!match?.[1] || !match[2]) throw new TypeError("GitHub repository must be owner/repo or https://github.com/owner/repo");
  return { owner: match[1], repo: match[2] };
}

function githubHeaders(token?: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "capability-repository-miner",
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };
}

async function json(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  const response = await fetchImpl(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function loadRawFile(fetchImpl: typeof fetch, owner: string, repo: string, commit: string, entry: TreeEntry, token: string | undefined, signal: AbortSignal | undefined): Promise<string | undefined> {
  const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(commit)}/${entry.path.split("/").map(encodeURIComponent).join("/")}`;
  const raw = await fetchImpl(rawUrl, { headers: token ? { authorization: `Bearer ${token}` } : undefined, signal });
  if (raw.ok) return raw.text();
  if (!token || !entry.sha) return undefined;
  const blobPayload = object(await json(fetchImpl, `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${entry.sha}`, { headers: githubHeaders(token), signal }));
  const encoded = text(blobPayload?.content)?.replace(/\s/g, "");
  if (!encoded || blobPayload?.encoding !== "base64") return undefined;
  return Buffer.from(encoded, "base64").toString("utf8");
}

function commentBefore(content: string, index: number): string | undefined {
  const before = content.slice(Math.max(0, index - 900), index);
  const jsdoc = /\/\*\*([\s\S]*?)\*\/\s*$/.exec(before)?.[1];
  if (jsdoc) {
    const cleaned = jsdoc.split("\n").map((line) => line.replace(/^\s*\*\s?/, "").trim()).filter((line) => line && !line.startsWith("@")).join(" ");
    if (cleaned) return cleaned.slice(0, 360);
  }
  const lines = before.split("\n").slice(-5).map((line) => line.trim()).filter(Boolean);
  const comments = lines.filter((line) => /^(?:\/\/|#|\/\/\/)/.test(line)).map((line) => line.replace(/^(?:\/\/\/|\/\/|#)\s?/, ""));
  return comments.length ? comments.join(" ").slice(0, 360) : undefined;
}

function braceRegion(content: string, index: number): string {
  const start = content.indexOf("{", index);
  if (start < 0 || start - index > 500) return content.slice(index, Math.min(content.length, index + 2500));
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let i = start; i < Math.min(content.length, start + 12000); i += 1) {
    const ch = content[i] ?? "";
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(index, i + 1);
    }
  }
  return content.slice(index, Math.min(content.length, index + 6000));
}

function pythonRegion(content: string, index: number): string {
  const startLine = lineAt(content, index);
  const lines = content.split("\n");
  const start = Math.max(0, startLine - 1);
  const first = lines[start] ?? "";
  const indent = first.match(/^\s*/)?.[0].length ?? 0;
  let end = Math.min(lines.length, start + 180);
  for (let i = start + 1; i < end; i += 1) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;
    const current = line.match(/^\s*/)?.[0].length ?? 0;
    if (current <= indent && /^(?:async\s+def|def|class)\s+/.test(line.trim())) { end = i; break; }
  }
  return lines.slice(start, end).join("\n");
}

function languageFor(path: string): string | undefined {
  const ext = extension(path);
  if ([".js", ".mjs", ".cjs", ".jsx"].includes(ext)) return "JavaScript";
  if ([".ts", ".mts", ".cts", ".tsx"].includes(ext)) return "TypeScript";
  if (ext === ".py") return "Python";
  if (ext === ".go") return "Go";
  if (ext === ".rs") return "Rust";
  if (ext === ".java") return "Java";
  if ([".kt", ".kts"].includes(ext)) return "Kotlin";
  if (ext === ".cs") return "C#";
  if (ext === ".rb") return "Ruby";
  if (ext === ".php") return "PHP";
  if (ext === ".swift") return "Swift";
  return undefined;
}

function findingsFromRegex(content: string, path: string, regex: RegExp, kind: RepositoryCandidateKind, nameGroup = 1): SymbolFinding[] {
  const results: SymbolFinding[] = [];
  regex.lastIndex = 0;
  for (;;) {
    const match = regex.exec(content);
    if (!match) break;
    const name = match[nameGroup];
    if (!name) continue;
    const index = match.index + (match[0].indexOf(name) >= 0 ? match[0].indexOf(name) : 0);
    const lowerExt = extension(path);
    const region = lowerExt === ".py" ? pythonRegion(content, index) : braceRegion(content, index);
    if ([".tsx", ".jsx"].includes(lowerExt) && /^[A-Z]/.test(name) && /return\s*\(?\s*</.test(region)) continue;
    results.push({ kind, name, symbol: name, line: lineAt(content, index), index, signature: match[0].trim().replace(/\s+/g, " ").slice(0, 500), description: commentBefore(content, match.index), language: languageFor(path), region });
  }
  return results;
}

function parseSource(content: string, path: string): SymbolFinding[] {
  const ext = extension(path);
  const results: SymbolFinding[] = [];
  if ([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"].includes(ext)) {
    results.push(...findingsFromRegex(content, path, /(?:^|\n)\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)(?:\s*:\s*[^\n{=]+)?\s*\{/gm, "function"));
    results.push(...findingsFromRegex(content, path, /(?:^|\n)\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=>/gm, "function"));
    results.push(...findingsFromRegex(content, path, /(?:^|\n)\s*export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/gm, "class"));
    results.push(...findingsFromRegex(content, path, /(?:^|\n)\s*(?:module\.exports\.|exports\.)([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>)/gm, "library-export"));
    const routeRegex = /\b(?:app|router)\.(get|post|put|patch|delete|options|head)\s*\(\s*["'`]([^"'`]+)["'`]/gim;
    for (;;) {
      const match = routeRegex.exec(content);
      if (!match) break;
      const method = (match[1] ?? "GET").toUpperCase();
      const route = match[2] ?? "/";
      results.push({ kind: "http-operation", name: `${method} ${route}`, line: lineAt(content, match.index), index: match.index, signature: match[0], description: commentBefore(content, match.index), language: languageFor(path), region: braceRegion(content, match.index) });
    }
  } else if (ext === ".py") {
    results.push(...findingsFromRegex(content, path, /^(?:async\s+)?def\s+([A-Za-z][\w]*)\s*\([^\n]*\)(?:\s*->\s*[^:]+)?\s*:/gm, "function"));
    results.push(...findingsFromRegex(content, path, /^class\s+([A-Za-z][\w]*)\s*(?:\([^\n]*\))?\s*:/gm, "class"));
    const routeRegex = /^\s*@(?:app|router|blueprint)\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/gim;
    for (;;) {
      const match = routeRegex.exec(content);
      if (!match) break;
      results.push({ kind: "http-operation", name: `${(match[1] ?? "GET").toUpperCase()} ${match[2] ?? "/"}`, line: lineAt(content, match.index), index: match.index, signature: match[0].trim(), description: commentBefore(content, match.index), language: "Python", region: pythonRegion(content, match.index) });
    }
  } else if (ext === ".go") {
    results.push(...findingsFromRegex(content, path, /^func\s+([A-Z][A-Za-z0-9_]*)\s*\([^\n]*\)/gm, "function"));
  } else if (ext === ".rs") {
    results.push(...findingsFromRegex(content, path, /^\s*pub\s+(?:async\s+)?fn\s+([A-Za-z][A-Za-z0-9_]*)\s*\([^\n]*\)/gm, "function"));
    results.push(...findingsFromRegex(content, path, /^\s*pub\s+(?:struct|enum)\s+([A-Za-z][A-Za-z0-9_]*)/gm, "class"));
  } else if (ext === ".java") {
    results.push(...findingsFromRegex(content, path, /^\s*public\s+(?:static\s+)?(?:synchronized\s+)?[A-Za-z0-9_<>,.?\[\]\s]+\s+([a-zA-Z][A-Za-z0-9_]*)\s*\([^;\n]*\)\s*(?:throws\s+[^\{]+)?\{/gm, "function"));
  } else if ([".kt", ".kts"].includes(ext)) {
    results.push(...findingsFromRegex(content, path, /^\s*(?:public\s+)?fun\s+([A-Za-z][A-Za-z0-9_]*)\s*\([^\n]*\)/gm, "function"));
  } else if (ext === ".cs") {
    results.push(...findingsFromRegex(content, path, /^\s*public\s+(?:static\s+)?(?:async\s+)?[A-Za-z0-9_<>,.?\[\]\s]+\s+([A-Za-z][A-Za-z0-9_]*)\s*\([^;\n]*\)\s*\{/gm, "function"));
  } else if (ext === ".rb") {
    results.push(...findingsFromRegex(content, path, /^\s*def\s+(?:self\.)?([A-Za-z][A-Za-z0-9_!?=]*)/gm, "function"));
  } else if (ext === ".php") {
    results.push(...findingsFromRegex(content, path, /^\s*public\s+(?:static\s+)?function\s+([A-Za-z][A-Za-z0-9_]*)\s*\([^\n]*\)/gm, "function"));
  } else if (ext === ".swift") {
    results.push(...findingsFromRegex(content, path, /^\s*public\s+(?:static\s+)?func\s+([A-Za-z][A-Za-z0-9_]*)\s*\([^\n]*\)/gm, "function"));
  }
  return results.filter((finding) => finding.kind === "http-operation" || !finding.symbol?.startsWith("_") );
}

function effectInference(region: string, path: string, line: number): RepositoryEffectInference[] {
  const rules: Array<{ effect: CapabilityEffect; regex: RegExp; detail: string; confidence: RepositoryMiningConfidence }> = [
    { effect: "filesystem.read", regex: /\b(?:readFile(?:Sync)?|read_text|read_bytes|os\.ReadFile|fs::read|File\.open\s*\([^,]+,\s*["']r|open\s*\([^,]+\))/i, detail: "source region contains a filesystem read primitive", confidence: "medium" },
    { effect: "filesystem.write", regex: /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|unlink(?:Sync)?|rm(?:Sync)?|mkdir(?:Sync)?|write_text|write_bytes|os\.WriteFile|fs::write|File\.write|open\s*\([^,]+,\s*["'][wa])/i, detail: "source region contains a filesystem mutation primitive", confidence: "medium" },
    { effect: "network.connect", regex: /\b(?:fetch\s*\(|axios\.|requests\.|httpx\.|urllib\.|https?\.request|https?\.get|reqwest|net\/http|URLSession|HttpClient)/i, detail: "source region contains an outbound network primitive", confidence: "medium" },
    { effect: "process.spawn", regex: /\b(?:spawn\s*\(|execFile\s*\(|exec\s*\(|child_process|subprocess\.|os\.system\s*\(|Command::new|ProcessBuilder)/i, detail: "source region contains a process execution primitive", confidence: "high" },
    { effect: "environment.read", regex: /\b(?:process\.env|os\.environ|os\.getenv|std::env|System\.getenv|Environment\.GetEnvironmentVariable)/i, detail: "source region reads process environment", confidence: "high" },
    { effect: "database.read", regex: /\b(?:SELECT\s+.+\s+FROM|\.findMany\s*\(|\.findUnique\s*\(|\.findOne\s*\(|\.query\s*\(|sqlite|postgres|mongodb|mongoose)/i, detail: "source region contains database/query signals", confidence: "low" },
    { effect: "database.write", regex: /\b(?:INSERT\s+INTO|UPDATE\s+.+\s+SET|DELETE\s+FROM|\.create\s*\(|\.update\s*\(|\.delete\s*\(|\.save\s*\()/i, detail: "source region contains database mutation signals", confidence: "low" },
    { effect: "email.send", regex: /\b(?:sendMail\s*\(|nodemailer|sendgrid|resend\.emails\.send|mailgun)/i, detail: "source region contains email delivery signals", confidence: "medium" },
    { effect: "git.commit", regex: /(?:git\s+commit|["']commit["']\s*\])/i, detail: "source region appears to invoke git commit", confidence: "medium" },
    { effect: "git.push", regex: /(?:git\s+push|["']push["']\s*\])/i, detail: "source region appears to invoke git push", confidence: "medium" }
  ];
  const results: RepositoryEffectInference[] = [];
  for (const rule of rules) {
    if (!rule.regex.test(region)) continue;
    results.push({ effect: rule.effect, confidence: rule.confidence, evidence: [{ kind: "effect", path, line, detail: rule.detail, strength: rule.confidence }] });
  }
  return results;
}

function usefulScore(finding: SymbolFinding): number {
  const normalized = `${finding.name} ${finding.description ?? ""}`.toLowerCase();
  let score = finding.kind === "http-operation" || finding.kind === "cli" ? 0.95 : finding.kind === "function" || finding.kind === "library-export" ? 0.68 : 0.48;
  if (ACTION_WORDS.some((word) => normalized.includes(word))) score += 0.14;
  if (finding.description) score += 0.08;
  if (/^(?:get|set|is|has|toString|equals|hashCode|constructor)$/i.test(finding.name)) score -= 0.22;
  if (/^(?:test|mock|fixture|setup|teardown|main)$/i.test(finding.name)) score -= 0.18;
  return Math.max(0, Math.min(1, score));
}

function queryScore(query: string | undefined, finding: SymbolFinding, path: string): number {
  if (!query?.trim()) return 0;
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1);
  if (!tokens.length) return 0;
  const haystack = `${finding.name} ${finding.description ?? ""} ${path} ${finding.signature}`.toLowerCase();
  return tokens.filter((token) => haystack.includes(token)).length / tokens.length;
}

function confidenceLevel(score: number): RepositoryMiningConfidence {
  return score >= 0.8 ? "high" : score >= 0.55 ? "medium" : "low";
}

function humanize(value: string): string {
  const spaced = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return spaced ? spaced.replace(/^./, (char) => char.toUpperCase()) : "Repository ability";
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "ability";
}

function corroboratingEvidence(finding: SymbolFinding, loaded: readonly LoadedFile[]): RepositoryEvidence[] {
  const symbol = finding.symbol;
  if (!symbol) return [];
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`);
  const result: RepositoryEvidence[] = [];
  for (const role of ["documentation", "test", "example"] as const) {
    const file = loaded.find((candidate) => candidate.role === role && regex.test(candidate.content));
    if (!file) continue;
    const index = file.content.search(regex);
    result.push({
      kind: role === "documentation" ? "documentation" : role,
      path: file.path,
      ...(index >= 0 ? { line: lineAt(file.content, index) } : {}),
      detail: `${symbol} is referenced by ${role} evidence`,
      strength: role === "test" ? "high" : "medium"
    });
  }
  return result;
}

function parsePackageManifest(file: LoadedFile | undefined): { npm?: { name: string; version?: string; bins: Record<string, string> }; findings: SymbolFinding[] } {
  if (!file) return { findings: [] };
  try {
    const pkg = object(JSON.parse(file.content));
    if (!pkg) return { findings: [] };
    const packageName = text(pkg.name);
    const version = text(pkg.version);
    const bins: Record<string, string> = {};
    if (typeof pkg.bin === "string" && packageName) bins[packageName.split("/").pop() ?? packageName] = pkg.bin;
    else {
      const binObject = object(pkg.bin);
      if (binObject) for (const [name, value] of Object.entries(binObject)) if (typeof value === "string") bins[name] = value;
    }
    const findings = Object.entries(bins).map(([name, target]) => ({ kind: "cli" as const, name: `${name} CLI`, symbol: name, line: 1, index: 0, signature: `${name} -> ${target}`, description: `Command-line entry point published by ${packageName ?? "this package"}.`, language: "CLI", region: file.content }));
    return { ...(packageName ? { npm: { name: packageName, ...(version ? { version } : {}), bins } } : {}), findings };
  } catch {
    return { findings: [] };
  }
}

function mcpSignals(loaded: readonly LoadedFile[]): string[] {
  const result = new Set<string>();
  for (const file of loaded) {
    if (/modelcontextprotocol|\bmcp\b/i.test(file.content)) result.add(file.path);
    if (result.size >= 12) break;
  }
  return [...result];
}

function repositoryHazards(loaded: readonly LoadedFile[], treeTruncated: boolean, sourceCoverageRatio: number): string[] {
  const hazards = new Set<string>();
  hazards.add("Repository mining is inference, not a trust decision. Generated candidates are non-executable until a verified adapter or native contract binds them.");
  hazards.add("Effect inference is intentionally incomplete: absence of an inferred effect never proves absence of that effect.");
  if (treeTruncated) hazards.add("GitHub returned a truncated recursive tree, so repository coverage is incomplete.");
  if (sourceCoverageRatio < 0.999) hazards.add(`Source analysis sampled ${(sourceCoverageRatio * 100).toFixed(1)}% of eligible source files under the configured limits.`);
  const joined = loaded.map((file) => file.content).join("\n");
  if (/\beval\s*\(|new\s+Function\s*\(|exec\s*\(/.test(joined)) hazards.add("Dynamic code execution signals were found; static effect inference may miss runtime behavior.");
  if (/node-gyp|ffi|ctypes|cffi|\.wasm\b|WebAssembly/i.test(joined)) hazards.add("Native/FFI/WASM signals were found; source-level analysis may not cover behavior outside the inspected language files.");
  if (/plugin|dynamic import|import\s*\(\s*[^"'`]/i.test(joined)) hazards.add("Plugin or dynamic-loading signals were found; runtime behavior may extend beyond statically visible code.");
  return [...hazards];
}

function candidateFromFinding(finding: SymbolFinding, sourcePath: string, loaded: readonly LoadedFile[], owner: string, repo: string, commit: string, query: string | undefined): RepositoryCapabilityCandidate {
  const declaration: RepositoryEvidence = {
    kind: finding.kind === "http-operation" ? "route" : finding.kind === "cli" ? "manifest" : "declaration",
    path: sourcePath,
    line: finding.line,
    detail: finding.signature,
    strength: finding.kind === "cli" || finding.kind === "http-operation" ? "high" : "medium"
  };
  const corroboration = corroboratingEvidence(finding, loaded);
  const effects = effectInference(finding.region, sourcePath, finding.line);
  const evidence = [declaration, ...corroboration, ...effects.flatMap((effect) => effect.evidence)];
  let score = finding.kind === "cli" || finding.kind === "http-operation" ? 0.66 : 0.5;
  if (finding.description) score += 0.08;
  if (corroboration.some((item) => item.kind === "documentation")) score += 0.1;
  if (corroboration.some((item) => item.kind === "test")) score += 0.16;
  if (corroboration.some((item) => item.kind === "example")) score += 0.1;
  if (effects.length) score += 0.04;
  const use = usefulScore(finding);
  score += use * 0.08;
  score = Math.min(0.98, score);
  const qScore = queryScore(query, finding, sourcePath);
  const symbolSlug = slug(finding.symbol ?? finding.name);
  const name = finding.kind === "http-operation" || finding.kind === "cli" ? finding.name : humanize(finding.name);
  const description = finding.description ?? (finding.kind === "http-operation" ? `Inferred HTTP operation ${finding.name}.` : finding.kind === "cli" ? finding.description ?? `Inferred command-line ability ${finding.name}.` : `Inferred repository ability exposed by ${finding.name}.`);
  const inferredEffects = effects.map((effect) => effect.effect);
  return {
    kind: finding.kind,
    candidateId: `github:${owner}/${repo}@${commit.slice(0, 12)}#${sourcePath}:${finding.line}:${finding.symbol ?? finding.name}`,
    name,
    description,
    ...(finding.symbol ? { symbol: finding.symbol } : {}),
    ...(finding.language ? { language: finding.language } : {}),
    sourcePath,
    line: finding.line,
    signature: finding.signature,
    confidence: { score: Number(score.toFixed(3)), level: confidenceLevel(score) },
    usefulnessScore: Number(use.toFixed(3)),
    queryScore: Number(qScore.toFixed(3)),
    evidence,
    effects,
    authority: { complete: false, note: "Effects were inferred from inspected evidence only. Treat undeclared behavior as unknown until a human or stronger verifier establishes a complete authority surface." },
    executable: false,
    draftContract: {
      specVersion: "0.1",
      id: `inferred/${slug(owner)}/${slug(repo)}/${symbolSlug}`,
      version: "0.0.0-inferred",
      name,
      description,
      effects: inferredEffects,
      metadata: {
        inferred: true,
        executable: false,
        authorityComplete: false,
        repository: `https://github.com/${owner}/${repo}`,
        commit,
        sourcePath,
        line: finding.line,
        symbol: finding.symbol ?? finding.name,
        confidence: Number(score.toFixed(3)),
        evidence: evidence.map((item) => ({ kind: item.kind, path: item.path, line: item.line, strength: item.strength }))
      }
    }
  };
}

export async function mineGitHubRepository(locator: string, options: RepositoryMiningOptions = {}): Promise<RepositoryMiningReport> {
  const { owner, repo } = parseRepositoryLocator(locator);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new TypeError("A fetch implementation is required");
  const token = options.githubToken ?? (typeof process !== "undefined" ? process.env.GITHUB_TOKEN : undefined);
  const headers = githubHeaders(token);
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const metadata = object(await json(fetchImpl, base, { headers, signal: options.signal }));
  if (!metadata) throw new TypeError(`Invalid GitHub repository metadata for ${owner}/${repo}`);
  const defaultBranch = text(metadata.default_branch) ?? "main";
  const ref = options.ref?.trim() || defaultBranch;
  const commitPayload = object(await json(fetchImpl, `${base}/commits/${encodeURIComponent(ref)}`, { headers, signal: options.signal }));
  const commit = text(commitPayload?.sha);
  const commitObject = object(commitPayload?.commit);
  const treeObject = object(commitObject?.tree);
  const treeSha = text(treeObject?.sha);
  if (!commit || !treeSha) throw new Error(`Could not resolve ${owner}/${repo}@${ref} to a commit tree`);
  const treePayload = object(await json(fetchImpl, `${base}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`, { headers, signal: options.signal }));
  const rawTree = Array.isArray(treePayload?.tree) ? treePayload.tree : [];
  const maxFiles = Math.max(8, Math.min(500, Math.trunc(options.maxFiles ?? 120)));
  const maxFileBytes = Math.max(4096, Math.min(2_000_000, Math.trunc(options.maxFileBytes ?? 180_000)));
  const entries: TreeEntry[] = rawTree.map((item) => object(item)).filter((item): item is JsonObject => Boolean(item)).map((item) => ({ path: text(item.path) ?? "", type: text(item.type) ?? "", ...(text(item.sha) ? { sha: text(item.sha) } : {}), ...(typeof item.size === "number" ? { size: item.size } : {}) })).filter((entry) => entry.type === "blob" && entry.path && isInteresting(entry.path) && (entry.size ?? 0) <= maxFileBytes);
  const sourceEligible = entries.filter((entry) => SOURCE_EXTENSIONS.has(extension(entry.path)) && roleForPath(entry.path) === "source").length;
  const selected = [...entries].sort((a, b) => pathPriority(b.path) - pathPriority(a.path) || (a.size ?? 0) - (b.size ?? 0) || a.path.localeCompare(b.path)).slice(0, maxFiles);
  const loaded: LoadedFile[] = [];
  for (const entry of selected) {
    try {
      const content = await loadRawFile(fetchImpl, owner, repo, commit, entry, token, options.signal);
      if (content === undefined || Buffer.byteLength(content, "utf8") > maxFileBytes) continue;
      loaded.push({ path: entry.path, content, size: Buffer.byteLength(content, "utf8"), role: roleForPath(entry.path) });
    } catch {
      // Mining is best-effort. Missing individual files reduce coverage instead of aborting the entire repository report.
    }
  }
  const sourceLoaded = loaded.filter((file) => file.role === "source" && SOURCE_EXTENSIONS.has(extension(file.path)));
  const sourceCoverageRatio = sourceEligible === 0 ? 1 : Math.min(1, sourceLoaded.length / sourceEligible);
  const packageFile = loaded.find((file) => file.path === "package.json" || file.path.endsWith("/package.json"));
  const packageParsed = parsePackageManifest(packageFile);
  const allFindings: Array<{ finding: SymbolFinding; path: string }> = [];
  for (const finding of packageParsed.findings) allFindings.push({ finding, path: packageFile?.path ?? "package.json" });
  for (const file of sourceLoaded) {
    for (const finding of parseSource(file.content, file.path)) allFindings.push({ finding, path: file.path });
  }
  const deduped = new Map<string, RepositoryCapabilityCandidate>();
  for (const { finding, path } of allFindings) {
    const candidate = candidateFromFinding(finding, path, loaded, owner, repo, commit, options.query);
    const key = `${candidate.sourcePath}:${candidate.line}:${candidate.symbol ?? candidate.name}`;
    const previous = deduped.get(key);
    if (!previous || candidate.confidence.score > previous.confidence.score) deduped.set(key, candidate);
  }
  const maxCandidates = Math.max(1, Math.min(1000, Math.trunc(options.maxCandidates ?? 200)));
  const candidates = [...deduped.values()]
    .filter((candidate) => !options.query?.trim() || candidate.queryScore > 0 || candidate.confidence.level === "high")
    .sort((a, b) => b.queryScore - a.queryScore || b.confidence.score - a.confidence.score || b.usefulnessScore - a.usefulnessScore || a.name.localeCompare(b.name))
    .slice(0, maxCandidates);
  const openapiFiles = entries.map((entry) => entry.path).filter((path) => /(?:openapi|swagger)\.(?:json|ya?ml)$/i.test(path)).slice(0, 20);
  const supported = new Set([...SOURCE_EXTENSIONS, ".md", ".mdx", ".rst", ".json", ".toml", ".mod", ".xml", ".gradle", ".kts", ".yaml", ".yml"]);
  const unsupportedExtensions = [...new Set(rawTree.map((item) => text(object(item)?.path)).filter((path): path is string => Boolean(path)).map(extension).filter((ext) => ext && !supported.has(ext)))].sort();
  const licenseObject = object(metadata.license);
  return {
    repository: {
      fullName: `${owner}/${repo}`,
      url: text(metadata.html_url) ?? `https://github.com/${owner}/${repo}`,
      ...(text(metadata.description) ? { description: text(metadata.description) } : {}),
      defaultBranch,
      ref,
      commit,
      ...(text(metadata.language) ? { language: text(metadata.language) } : {}),
      ...(text(licenseObject?.spdx_id) ? { license: text(licenseObject?.spdx_id) } : {}),
      archived: metadata.archived === true
    },
    packageHints: {
      ...(packageParsed.npm ? { npm: packageParsed.npm } : {}),
      openapiFiles,
      mcpSignals: mcpSignals(loaded)
    },
    coverage: {
      treeTruncated: treePayload?.truncated === true,
      eligibleFiles: entries.length,
      analyzedFiles: loaded.length,
      sourceEligible,
      sourceAnalyzed: sourceLoaded.length,
      sourceCoverageRatio: Number(sourceCoverageRatio.toFixed(4)),
      maxFiles,
      maxFileBytes
    },
    candidates,
    hazards: repositoryHazards(loaded, treePayload?.truncated === true, sourceCoverageRatio),
    unsupportedExtensions,
    generatedAt: new Date().toISOString()
  };
}
