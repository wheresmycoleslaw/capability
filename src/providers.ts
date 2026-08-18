import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Capability, JsonValue } from "./types.js";
import { capabilitiesFromOpenApi, type OpenApiDocument } from "./openapi.js";
import { connectStdioMcpCapabilities } from "./mcp-import.js";
import { AbilityProviderRegistry, providerFromCapabilities, type AbilityProvider, type AbilitySourceKind } from "./need.js";

export type ProviderConfig = {
  providers?: Array<
    | {
        type: "mcp";
        id: string;
        command: string;
        args?: string[];
        namespace?: string;
        version?: string;
        effectsComplete?: boolean;
        priority?: number;
        trusted?: boolean;
      }
    | {
        type: "openapi";
        id: string;
        source: string;
        namespace?: string;
        baseUrl?: string;
        headers?: Record<string, string>;
        priority?: number;
        trusted?: boolean;
      }
  >;
};

export type LoadedProviderRegistry = {
  registry: AbilityProviderRegistry;
  sources: { id: string; type: "mcp" | "openapi"; abilities: number }[];
  close(): Promise<void>;
};

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function readJsonSource(source: string): Promise<unknown> {
  if (!isUrl(source)) return JSON.parse(await readFile(resolve(source), "utf8"));
  const response = await fetch(source, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Failed to fetch ${source}: HTTP ${response.status}`);
  return response.json();
}

export function abilityProviderFromCapabilities(options: {
  id: string;
  kind: Exclude<AbilitySourceKind, "gap">;
  description: string;
  priority?: number;
  trusted?: boolean;
  capabilities: readonly Capability[];
  close?: () => void | Promise<void>;
}): AbilityProvider {
  const provider = providerFromCapabilities(options);
  return options.close ? { ...provider, close: options.close } : provider;
}

export async function loadProviderConfig(path = "capability.providers.json"): Promise<LoadedProviderRegistry> {
  const config = JSON.parse(await readFile(resolve(path), "utf8")) as ProviderConfig;
  const registry = new AbilityProviderRegistry();
  const sources: LoadedProviderRegistry["sources"] = [];

  for (const entry of config.providers ?? []) {
    if (entry.type === "mcp") {
      const connection = await connectStdioMcpCapabilities({
        command: entry.command,
        args: entry.args,
        namespace: entry.namespace ?? entry.id,
        version: entry.version,
        effectsComplete: entry.effectsComplete
      });
      registry.register(abilityProviderFromCapabilities({
        id: entry.id,
        kind: "mcp",
        description: `Prepared MCP provider ${entry.id}`,
        priority: entry.priority ?? 20,
        trusted: entry.trusted ?? false,
        capabilities: connection.capabilities,
        close: () => connection.session.close()
      }));
      sources.push({ id: entry.id, type: "mcp", abilities: connection.capabilities.length });
      continue;
    }

    const document = await readJsonSource(entry.source) as OpenApiDocument;
    const capabilities = capabilitiesFromOpenApi(document, {
      namespace: entry.namespace ?? entry.id,
      baseUrl: entry.baseUrl,
      headers: entry.headers
    });
    registry.register(abilityProviderFromCapabilities({
      id: entry.id,
      kind: "openapi",
      description: `Prepared OpenAPI provider ${entry.id}`,
      priority: entry.priority ?? 30,
      trusted: entry.trusted ?? false,
      capabilities
    }));
    sources.push({ id: entry.id, type: "openapi", abilities: capabilities.length });
  }

  return { registry, sources, close: () => registry.close() };
}

export function providerConfigTemplate(): ProviderConfig {
  return {
    providers: [
      {
        type: "mcp",
        id: "company-tools",
        command: "node",
        args: ["./mcp-server.mjs"],
        namespace: "company",
        priority: 20,
        trusted: false
      },
      {
        type: "openapi",
        id: "service-api",
        source: "./openapi.json",
        namespace: "service",
        priority: 30,
        trusted: false,
        headers: { authorization: "Bearer ${TOKEN}" }
      }
    ]
  };
}

export function expandProviderEnvironment(value: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => env[name] ?? "");
  }
  if (Array.isArray(value)) return value.map((entry) => expandProviderEnvironment(entry, env));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, expandProviderEnvironment(entry, env)])) as Record<string, JsonValue>;
  }
  return value;
}
