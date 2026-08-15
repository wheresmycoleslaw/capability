#!/usr/bin/env node
import { createInterface } from "node:readline";
import { CapabilityNetworkMcpBridge } from "./network-mcp.js";

const MODERN_VERSION = "2026-07-28";
const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
const SERVER_INFO = { name: "capability-network", version: "0.5.0" };
const bridge = new CapabilityNetworkMcpBridge({ indexes: process.env.CAPABILITY_INDEX ? [process.env.CAPABILITY_INDEX] : undefined });

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown> };

function modernMeta() {
  return { "io.modelcontextprotocol/serverInfo": SERVER_INFO };
}

function result(id: JsonRpcId, value: unknown) {
  return { jsonrpc: "2.0", id, result: value };
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

async function handle(request: JsonRpcRequest) {
  const id = request.id ?? null;
  const method = request.method;
  if (!method) return rpcError(id, -32600, "Invalid Request");

  if (method === "server/discover") {
    return result(id, {
      supportedVersions: [MODERN_VERSION],
      capabilities: { tools: {} },
      instructions: "Use capability_search to discover abilities not already available, capability_inspect before execution, and capability_execute only after reviewing declared effects and required approval.",
      _meta: modernMeta()
    });
  }

  if (method === "initialize") {
    const requested = typeof request.params?.protocolVersion === "string" ? request.params.protocolVersion : LEGACY_VERSIONS[0];
    const negotiated = (LEGACY_VERSIONS as readonly string[]).includes(requested) ? requested : LEGACY_VERSIONS[0];
    return result(id, {
      protocolVersion: negotiated,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: "Capability is a bootstrap MCP server: search the federated ability network, inspect contracts before code loading, and execute through verified isolated acquisition."
    });
  }

  if (method === "notifications/initialized" || method === "notifications/cancelled") return undefined;
  if (method === "ping") return result(id, {});
  if (method === "tools/list") return result(id, bridge.listTools());
  if (method === "tools/call") {
    const name = typeof request.params?.name === "string" ? request.params.name : "";
    if (!name) return rpcError(id, -32602, "tools/call requires params.name");
    const args = request.params?.arguments;
    const normalized = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
    return result(id, await bridge.callTool(name, normalized));
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}

async function dispatch(value: unknown): Promise<unknown> {
  if (Array.isArray(value)) {
    const replies = (await Promise.all(value.map((item) => handle((item ?? {}) as JsonRpcRequest)))).filter((item) => item !== undefined);
    return replies.length ? replies : undefined;
  }
  return handle((value ?? {}) as JsonRpcRequest);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  try {
    const response = await dispatch(JSON.parse(line));
    if (response !== undefined) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(rpcError(null, -32700, "Parse error", error instanceof Error ? error.message : String(error)))}\n`);
  }
}
