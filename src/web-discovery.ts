import { fetchCapabilityIndex, type CapabilityIndexDocument } from "./public-index.js";

export const CAPABILITY_SITE_DISCOVERY_VERSION = "0.1" as const;
export const WELL_KNOWN_CAPABILITY_PATHS = ["/.well-known/capabilities", "/.well-known/capabilities.json"] as const;

export type CapabilitySiteMcp = {
  transport: "stdio" | "http";
  command?: string;
  args?: readonly string[];
  url?: string;
};

export type CapabilitySiteDocument = {
  capabilityDiscoveryVersion: typeof CAPABILITY_SITE_DISCOVERY_VERSION;
  indexes: readonly string[];
  package?: { name: string; version?: string };
  mcp?: readonly CapabilitySiteMcp[];
  documentation?: string;
  repository?: string;
  metadata?: Readonly<Record<string, string>>;
};

export type CapabilitySiteProbe = {
  origin: string;
  discoveryUrl: string;
  document: CapabilitySiteDocument;
  indexes: readonly { url: string; document: CapabilityIndexDocument }[];
};

function httpUrl(value: string, allowHttp = false): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (allowHttp && url.protocol === "http:");
  } catch {
    return false;
  }
}

export function validateCapabilitySiteDocument(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["discovery document must be an object"];
  const document = value as Record<string, unknown>;
  const issues: string[] = [];
  if (document.capabilityDiscoveryVersion !== CAPABILITY_SITE_DISCOVERY_VERSION) issues.push(`capabilityDiscoveryVersion must be ${CAPABILITY_SITE_DISCOVERY_VERSION}`);
  if (!Array.isArray(document.indexes) || document.indexes.length === 0) issues.push("indexes must be a non-empty array");
  else for (const [i, item] of document.indexes.entries()) if (typeof item !== "string" || !httpUrl(item, true)) issues.push(`indexes[${i}] must be an http(s) URL`);
  if (document.documentation !== undefined && (typeof document.documentation !== "string" || !httpUrl(document.documentation, true))) issues.push("documentation must be an http(s) URL");
  if (document.repository !== undefined && (typeof document.repository !== "string" || !httpUrl(document.repository, true))) issues.push("repository must be an http(s) URL");
  if (document.package !== undefined) {
    if (!document.package || typeof document.package !== "object" || Array.isArray(document.package)) issues.push("package must be an object");
    else {
      const pkg = document.package as Record<string, unknown>;
      if (typeof pkg.name !== "string" || !pkg.name) issues.push("package.name is required");
      if (pkg.version !== undefined && typeof pkg.version !== "string") issues.push("package.version must be a string");
    }
  }
  if (document.mcp !== undefined) {
    if (!Array.isArray(document.mcp)) issues.push("mcp must be an array");
    else for (const [i, item] of document.mcp.entries()) {
      if (!item || typeof item !== "object" || Array.isArray(item)) { issues.push(`mcp[${i}] must be an object`); continue; }
      const mcp = item as Record<string, unknown>;
      if (mcp.transport !== "stdio" && mcp.transport !== "http") issues.push(`mcp[${i}].transport must be stdio or http`);
      if (mcp.transport === "stdio" && (typeof mcp.command !== "string" || !mcp.command)) issues.push(`mcp[${i}].command is required for stdio`);
      if (mcp.transport === "http" && (typeof mcp.url !== "string" || !httpUrl(mcp.url, true))) issues.push(`mcp[${i}].url is required for http`);
      if (mcp.args !== undefined && (!Array.isArray(mcp.args) || mcp.args.some((arg) => typeof arg !== "string"))) issues.push(`mcp[${i}].args must be a string array`);
    }
  }
  if (document.metadata !== undefined && (!document.metadata || typeof document.metadata !== "object" || Array.isArray(document.metadata))) issues.push("metadata must be an object");
  return issues;
}

export function createCapabilitySiteDocument(input: Omit<CapabilitySiteDocument, "capabilityDiscoveryVersion">): CapabilitySiteDocument {
  const document: CapabilitySiteDocument = { capabilityDiscoveryVersion: CAPABILITY_SITE_DISCOVERY_VERSION, ...input };
  const issues = validateCapabilitySiteDocument(document);
  if (issues.length) throw new TypeError(issues.join("; "));
  return document;
}

export function capabilityDiscoveryUrls(site: string | URL): string[] {
  const base = new URL(site.toString());
  const origin = `${base.protocol}//${base.host}`;
  return WELL_KNOWN_CAPABILITY_PATHS.map((path) => new URL(path, origin).href);
}

export async function fetchCapabilitySiteDocument(
  site: string | URL,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<{ url: string; document: CapabilitySiteDocument }> {
  if (!fetchImpl) throw new TypeError("A fetch implementation is required");
  const attempted: string[] = [];
  for (const url of capabilityDiscoveryUrls(site)) {
    attempted.push(url);
    let response: Response;
    try { response = await fetchImpl(url, { headers: { accept: "application/json" }, redirect: "follow" }); }
    catch { continue; }
    if (!response.ok) continue;
    let document: CapabilitySiteDocument;
    try { document = await response.json() as CapabilitySiteDocument; }
    catch { continue; }
    const issues = validateCapabilitySiteDocument(document);
    if (issues.length) throw new TypeError(`Invalid capability discovery document at ${url}: ${issues.join("; ")}`);
    return { url, document };
  }
  throw new Error(`No Capability discovery document found. Tried: ${attempted.join(", ")}`);
}

export async function probeCapabilitySite(
  site: string | URL,
  options: { fetch?: typeof fetch; fetchIndexes?: boolean } = {}
): Promise<CapabilitySiteProbe> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const found = await fetchCapabilitySiteDocument(site, fetchImpl);
  const indexes = options.fetchIndexes === false
    ? []
    : await Promise.all(found.document.indexes.map(async (url) => ({ url, document: await fetchCapabilityIndex(url, fetchImpl) })));
  const originUrl = new URL(site.toString());
  return { origin: `${originUrl.protocol}//${originUrl.host}`, discoveryUrl: found.url, document: found.document, indexes };
}
