import { CapabilityHub, capabilityDoctor, DEFAULT_CAPABILITY_INDEX_URL } from "./ecosystem.js";
import { discoverSoftwareWorld } from "./external-discovery.js";
import { probeCapabilitySite } from "./web-discovery.js";
import { mineGitHubRepository } from "./repository-mine.js";
import { activateForgedAbility, forgeGitHubAbility, solveSoftwareIntent } from "./forge.js";
import { metabolizeIntent, metabolicCoverage } from "./metabolism.js";
import { composeIntent } from "./metabolic-compose.js";
import { need, type AbilityProviderRegistry } from "./need.js";

export type NetworkMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
};

const tools: readonly NetworkMcpTool[] = [
  {
    name: "capability_need",
    title: "Get an Ability",
    description: "Primary Capability entry point. Describe the outcome you need. Capability prefers prepared providers such as approved connectors, MCP tools, OpenAPI operations and native abilities, then falls back to existing software only when necessary. With input, it can execute through the selected provider and return the resulting receipt.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Outcome or ability needed" },
        input: {},
        execute: { type: "boolean", default: false },
        approved: { type: "boolean", default: false },
        pythonPackage: { type: "string" },
        pythonVersion: { type: "string" },
        ociImage: { type: "string" },
        ociArgs: { type: "array", items: { type: "string" } },
        externalOnly: { type: "boolean", default: false }
      },
      required: ["query"]
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  {
    name: "capability_search",
    title: "Search Capability Network",
    description: "Discover executable abilities from the federated Capability network before installing code.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 25 } }, required: ["query"] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "capability_search_world",
    title: "Search the Software World",
    description: "Advanced discovery across native Capability indexes plus external npm and GitHub catalogs. External results are candidates, not trusted executable capabilities, until a contract or binder supplies a defensible execution boundary.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 25 },
        npm: { type: "boolean", default: true },
        github: { type: "boolean", default: true }
      },
      required: ["query"]
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "capability_mine_repository",
    title: "Mine GitHub Repository Abilities",
    description: "Advanced: inspect an arbitrary GitHub repository at an exact commit and infer useful public abilities without executing repository code. Inferences remain non-executable candidates.",
    inputSchema: {
      type: "object",
      properties: {
        repository: { type: "string", description: "owner/repo or a GitHub repository URL" },
        ref: { type: "string" },
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 500 },
        maxFiles: { type: "integer", minimum: 8, maximum: 500 }
      },
      required: ["repository"]
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "capability_forge_repository",
    title: "Forge Repository Ability",
    description: "Advanced: turn a mined GitHub function or CLI into a private Capability sidecar pinned to an exact npm artifact and source revision when available. First execution requires explicit approval and Docker isolation.",
    inputSchema: {
      type: "object",
      properties: {
        repository: { type: "string" },
        query: { type: "string" },
        symbol: { type: "string" },
        candidateId: { type: "string" },
        input: {},
        approved: { type: "boolean", default: false },
        allowUnverifiedSource: { type: "boolean", default: false }
      },
      required: ["repository"]
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  {
    name: "capability_solve",
    title: "Solve With the Software World",
    description: "Advanced: search native abilities and existing software, then forge a defensible npm-backed operation when necessary.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        input: {},
        approved: { type: "boolean", default: false },
        externalOnly: { type: "boolean", default: false },
        allowUnverifiedSource: { type: "boolean", default: false }
      },
      required: ["query"]
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  {
    name: "capability_metabolize",
    title: "Metabolize Existing Software",
    description: "Advanced substrate control for acquiring an ability through native Capability, npm/GitHub Forge, an explicitly selected PyPI package, or an OCI image.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, input: {}, approved: { type: "boolean", default: false }, pythonPackage: { type: "string" }, pythonVersion: { type: "string" }, ociImage: { type: "string" }, ociArgs: { type: "array", items: { type: "string" } }, externalOnly: { type: "boolean", default: false } }, required: ["query"] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  {
    name: "capability_compose",
    title: "Compose Capability Pipeline",
    description: "Advanced: discover compatible contracts, synthesize a composite manifest and optionally execute the pipeline with per-step receipts.",
    inputSchema: { type: "object", properties: { intent: { type: "string" }, input: {}, approved: { type: "boolean", default: false } }, required: ["intent"] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  {
    name: "capability_coverage",
    title: "Capability Software Coverage",
    description: "Report which software families Capability can currently discover, mine, bind and execute.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "capability_inspect",
    title: "Inspect Capability",
    description: "Inspect a discovered ability's inert contract, package identity, effects, and version without executing its code.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "capability_execute",
    title: "Acquire and Execute Capability",
    description: "Resolve, verify, acquire, authorize, and execute a known Capability-network ability through Capability's isolation boundary.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, input: {}, approved: { type: "boolean", default: false } }, required: ["id", "input"] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  },
  {
    name: "capability_probe_site",
    title: "Probe Website for Capabilities",
    description: "Check a website's /.well-known/capabilities discovery document and enumerate the Capability indexes it advertises.",
    inputSchema: { type: "object", properties: { site: { type: "string" } }, required: ["site"] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "capability_doctor",
    title: "Capability Network Status",
    description: "Check whether the local environment can reach the Capability network and provide an isolation boundary.",
    inputSchema: { type: "object", properties: { index: { type: "string" } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }
];

function textResult(value: unknown, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
}

export class CapabilityNetworkMcpBridge {
  private readonly indexes: readonly string[];
  private readonly providers?: AbilityProviderRegistry;

  constructor(options: { indexes?: readonly string[]; providers?: AbilityProviderRegistry } = {}) {
    this.indexes = options.indexes?.length ? [...options.indexes] : [DEFAULT_CAPABILITY_INDEX_URL];
    this.providers = options.providers;
  }

  listTools() { return { tools: [...tools] }; }

  async callTool(name: string, args: Record<string, unknown> = {}) {
    try {
      if (name === "capability_need") {
        const query = typeof args.query === "string" ? args.query : "";
        if (!query) throw new TypeError("query is required");
        return textResult(await need(query, {
          providers: this.providers,
          indexes: this.indexes,
          ...(args.input !== undefined ? { input: args.input } : {}),
          execute: args.execute === true || args.input !== undefined,
          approved: args.approved === true,
          pythonPackage: typeof args.pythonPackage === "string" ? args.pythonPackage : undefined,
          pythonVersion: typeof args.pythonVersion === "string" ? args.pythonVersion : undefined,
          ociImage: typeof args.ociImage === "string" ? args.ociImage : undefined,
          ociArgs: Array.isArray(args.ociArgs) ? args.ociArgs.filter((value): value is string => typeof value === "string") : undefined,
          externalOnly: args.externalOnly === true
        }));
      }
      if (name === "capability_search") {
        const query = typeof args.query === "string" ? args.query : "";
        if (!query) throw new TypeError("query is required");
        const limit = typeof args.limit === "number" ? Math.max(1, Math.min(25, Math.trunc(args.limit))) : 10;
        const hub = new CapabilityHub({ indexes: this.indexes });
        const matches = await hub.discover({ text: query, limit });
        return textResult(matches.map((entry) => ({
          id: entry.capability.manifest.id,
          version: entry.capability.manifest.version,
          name: entry.capability.manifest.name,
          description: entry.capability.manifest.description,
          effects: entry.capability.manifest.effects ?? [],
          package: `${entry.package.name}@${entry.package.version}`,
          score: entry.score,
          reasons: entry.reasons
        })));
      }
      if (name === "capability_search_world") {
        const query = typeof args.query === "string" ? args.query : "";
        if (!query) throw new TypeError("query is required");
        const limit = typeof args.limit === "number" ? Math.max(1, Math.min(25, Math.trunc(args.limit))) : 10;
        return textResult(await discoverSoftwareWorld(query, {
          indexes: this.indexes,
          limit,
          npm: args.npm !== false,
          github: args.github !== false
        }));
      }
      if (name === "capability_mine_repository") {
        if (typeof args.repository !== "string" || !args.repository) throw new TypeError("repository is required");
        return textResult(await mineGitHubRepository(args.repository, {
          ref: typeof args.ref === "string" ? args.ref : undefined,
          query: typeof args.query === "string" ? args.query : undefined,
          maxCandidates: typeof args.limit === "number" ? Math.max(1, Math.min(500, Math.trunc(args.limit))) : 100,
          maxFiles: typeof args.maxFiles === "number" ? Math.max(8, Math.min(500, Math.trunc(args.maxFiles))) : 120
        }));
      }
      if (name === "capability_forge_repository") {
        if (typeof args.repository !== "string" || !args.repository) throw new TypeError("repository is required");
        const forged = await forgeGitHubAbility(args.repository, {
          query: typeof args.query === "string" ? args.query : undefined,
          symbol: typeof args.symbol === "string" ? args.symbol : undefined,
          candidateId: typeof args.candidateId === "string" ? args.candidateId : undefined,
          allowUnverifiedSource: args.allowUnverifiedSource === true
        });
        const receipt = args.input !== undefined ? await activateForgedAbility(forged, args.input, { approved: args.approved === true }) : undefined;
        return textResult({ ...forged, ...(receipt ? { receipt } : {}) });
      }
      if (name === "capability_solve") {
        const query = typeof args.query === "string" ? args.query : "";
        if (!query) throw new TypeError("query is required");
        return textResult(await solveSoftwareIntent(query, {
          indexes: this.indexes,
          ...(args.input !== undefined ? { input: args.input } : {}),
          approved: args.approved === true,
          externalOnly: args.externalOnly === true,
          allowUnverifiedSource: args.allowUnverifiedSource === true
        }));
      }
      if (name === "capability_metabolize") {
        const query = typeof args.query === "string" ? args.query : "";
        if (!query) throw new TypeError("query is required");
        return textResult(await metabolizeIntent(query, {
          indexes: this.indexes,
          ...(args.input !== undefined ? { input: args.input } : {}),
          approved: args.approved === true,
          pythonPackage: typeof args.pythonPackage === "string" ? args.pythonPackage : undefined,
          pythonVersion: typeof args.pythonVersion === "string" ? args.pythonVersion : undefined,
          ociImage: typeof args.ociImage === "string" ? args.ociImage : undefined,
          ociArgs: Array.isArray(args.ociArgs) ? args.ociArgs.filter((value): value is string => typeof value === "string") : undefined,
          externalOnly: args.externalOnly === true
        }));
      }
      if (name === "capability_compose") {
        const intent = typeof args.intent === "string" ? args.intent : "";
        if (!intent) throw new TypeError("intent is required");
        return textResult(await composeIntent(intent, { indexes: this.indexes, ...(args.input !== undefined ? { input: args.input } : {}), approved: args.approved === true }));
      }
      if (name === "capability_coverage") return textResult(metabolicCoverage());
      if (name === "capability_inspect") {
        if (typeof args.id !== "string" || !args.id) throw new TypeError("id is required");
        const hub = new CapabilityHub({ indexes: this.indexes });
        return textResult(await hub.resolve(args.id));
      }
      if (name === "capability_execute") {
        if (typeof args.id !== "string" || !args.id) throw new TypeError("id is required");
        const hub = new CapabilityHub({ indexes: this.indexes });
        const execution = await hub.run(args.id, args.input, { approved: args.approved === true });
        return textResult({
          capability: execution.receipt.capability,
          package: `${execution.installed.packageName}@${execution.installed.packageVersion}`,
          trust: execution.trust,
          receipt: execution.receipt
        });
      }
      if (name === "capability_probe_site") {
        if (typeof args.site !== "string" || !args.site) throw new TypeError("site is required");
        return textResult(await probeCapabilitySite(args.site));
      }
      if (name === "capability_doctor") {
        return textResult(await capabilityDoctor({ index: typeof args.index === "string" ? args.index : this.indexes[0] }));
      }
      throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
      return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
    }
  }
}

export function capabilityNetworkMcpTools(): readonly NetworkMcpTool[] { return [...tools]; }
