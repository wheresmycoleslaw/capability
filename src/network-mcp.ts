import { CapabilityHub, capabilityDoctor, DEFAULT_CAPABILITY_INDEX_URL } from "./ecosystem.js";
import { discoverSoftwareWorld } from "./external-discovery.js";
import { probeCapabilitySite } from "./web-discovery.js";

export type NetworkMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
};

const tools: readonly NetworkMcpTool[] = [
  {
    name: "capability_search",
    title: "Search Capability Network",
    description: "Discover executable abilities from the federated Capability network before installing code. Use this when you need an ability that is not already available as a tool.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 25 } }, required: ["query"] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "capability_search_world",
    title: "Search the Software World",
    description: "Search native Capability indexes plus external npm and GitHub catalogs. External results are candidates, not trusted executable capabilities, until a native contract, OpenAPI/MCP import, or sidecar bridge binds a specific operation and authority surface.",
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
    name: "capability_inspect",
    title: "Inspect Capability",
    description: "Inspect a discovered ability's inert contract, package identity, effects, and version without executing its code.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "capability_execute",
    title: "Acquire and Execute Capability",
    description: "Resolve, verify, acquire, authorize, and execute an ability through Capability's isolation boundary. Mutating or open-world effects remain subject to policy and explicit approval.",
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
  constructor(options: { indexes?: readonly string[] } = {}) {
    this.indexes = options.indexes?.length ? [...options.indexes] : [DEFAULT_CAPABILITY_INDEX_URL];
  }

  listTools() { return { tools: [...tools] }; }

  async callTool(name: string, args: Record<string, unknown> = {}) {
    try {
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
