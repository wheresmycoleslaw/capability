import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { defineCapability } from "./define.js";
import { slugify } from "./utils.js";
import type { Capability, CapabilityEffect, JsonSchema } from "./types.js";

export type ImportableMcpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

export type McpToolCaller = (name: string, input: unknown) => unknown | Promise<unknown>;

export type McpImportOptions = {
  namespace?: string;
  version?: string;
  callTool: McpToolCaller;
  baseEffects?: readonly CapabilityEffect[];
  effectsComplete?: boolean;
  transport?: string;
};

export type StdioMcpOptions = {
  command: string;
  args?: readonly string[];
  namespace?: string;
  version?: string;
  protocolVersion?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  effectsComplete?: boolean;
};

type JsonRpcId = number;
type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function normalizeSchema(value: unknown): JsonSchema | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonSchema : undefined;
}

function importedEffects(tool: ImportableMcpTool, options: McpImportOptions): CapabilityEffect[] {
  const effects: CapabilityEffect[] = [...(options.baseEffects ?? [])];
  if (tool.annotations?.openWorldHint) effects.push("network.connect");
  if (tool.annotations?.destructiveHint) effects.push("custom:mcp.destructive");
  if (options.effectsComplete !== true) effects.push("custom:mcp.opaque-effects");
  return [...new Set(effects)];
}

function outputFromToolResult(value: unknown): unknown {
  const result = asRecord(value);
  if (!result) return value;
  if (result.isError === true) {
    const content = Array.isArray(result.content) ? result.content : [];
    const message = content.map((item) => asRecord(item)?.text).filter((text): text is string => typeof text === "string").join("\n") || "MCP tool returned an error";
    throw new Error(message);
  }
  if (result.structuredContent !== undefined) return result.structuredContent;
  const content = Array.isArray(result.content) ? result.content : [];
  const texts = content.map((item) => asRecord(item)?.text).filter((text): text is string => typeof text === "string");
  if (texts.length === 1) {
    try { return JSON.parse(texts[0]!); } catch { return texts[0]; }
  }
  return texts.length ? texts : value;
}

export function capabilitiesFromMcpTools(tools: readonly ImportableMcpTool[], options: McpImportOptions): Capability[] {
  const namespace = slugify(options.namespace ?? "mcp");
  const version = options.version && /^\d+\.\d+\.\d+/.test(options.version) ? options.version : "0.0.0";
  return tools.map((tool) => {
    if (!tool.name) throw new TypeError("MCP tool name is required");
    const effects = importedEffects(tool, options);
    return defineCapability<unknown, unknown>({
      manifest: {
        specVersion: "0.1",
        id: `${namespace}/${slugify(tool.name)}`,
        version,
        name: tool.title ?? tool.name,
        description: tool.description ?? `Imported MCP tool ${tool.name}`,
        input: normalizeSchema(tool.inputSchema) ?? { type: "object" },
        ...(normalizeSchema(tool.outputSchema) ? { output: normalizeSchema(tool.outputSchema) } : {}),
        effects,
        behavior: {
          deterministic: false,
          idempotent: tool.annotations?.idempotentHint === true,
          reversible: false
        },
        tags: ["mcp", "imported", ...(options.transport ? [options.transport] : [])],
        metadata: {
          mcpTool: tool.name,
          transport: options.transport ?? "host-provided",
          authorityComplete: options.effectsComplete === true
        }
      },
      async execute(input: unknown) {
        return outputFromToolResult(await options.callTool(tool.name, input));
      }
    });
  });
}

export class StdioMcpSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly input: Interface;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private nextId = 1;
  private stderr = "";
  private started = false;

  constructor(private readonly options: StdioMcpOptions) {
    if (!options.command) throw new TypeError("MCP stdio command is required");
    this.child = spawn(options.command, [...(options.args ?? [])], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => { this.stderr = `${this.stderr}${String(chunk)}`.slice(-16_384); });
    this.input = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.input.on("line", (line) => this.handleLine(line));
    this.child.once("error", (error) => this.rejectAll(error));
    this.child.once("exit", (code, signal) => this.rejectAll(new Error(`MCP server exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}${this.stderr ? `: ${this.stderr.trim()}` : ""}`)));
  }

  private handleLine(line: string) {
    if (!line.trim()) return;
    let message: JsonRpcMessage;
    try { message = JSON.parse(line) as JsonRpcMessage; } catch { return; }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message ?? `MCP error ${message.error.code ?? "unknown"}`));
    else pending.resolve(message.result);
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private send(value: unknown) {
    if (!this.child.stdin.writable) throw new Error("MCP server stdin is not writable");
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }); }
      catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(method: string, params?: Record<string, unknown>) {
    this.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.request("initialize", {
      protocolVersion: this.options.protocolVersion ?? "2025-11-25",
      capabilities: {},
      clientInfo: { name: "capability-mcp-import", version: "0.6.0" }
    });
    this.notify("notifications/initialized");
    this.started = true;
  }

  async listTools(): Promise<ImportableMcpTool[]> {
    await this.start();
    const result = asRecord(await this.request("tools/list"));
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    return tools.flatMap((raw) => {
      const tool = asRecord(raw);
      if (!tool || typeof tool.name !== "string") return [];
      const annotations = asRecord(tool.annotations);
      return [{
        name: tool.name,
        ...(typeof tool.title === "string" ? { title: tool.title } : {}),
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        ...(normalizeSchema(tool.inputSchema) ? { inputSchema: normalizeSchema(tool.inputSchema) } : {}),
        ...(normalizeSchema(tool.outputSchema) ? { outputSchema: normalizeSchema(tool.outputSchema) } : {}),
        ...(annotations ? { annotations: {
          ...(typeof annotations.readOnlyHint === "boolean" ? { readOnlyHint: annotations.readOnlyHint } : {}),
          ...(typeof annotations.destructiveHint === "boolean" ? { destructiveHint: annotations.destructiveHint } : {}),
          ...(typeof annotations.idempotentHint === "boolean" ? { idempotentHint: annotations.idempotentHint } : {}),
          ...(typeof annotations.openWorldHint === "boolean" ? { openWorldHint: annotations.openWorldHint } : {})
        } } : {})
      }];
    });
  }

  async callTool(name: string, input: unknown): Promise<unknown> {
    await this.start();
    const args = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : { value: input };
    return this.request("tools/call", { name, arguments: args });
  }

  close(): void {
    this.input.close();
    if (!this.child.killed) this.child.kill();
  }
}

export async function connectStdioMcpCapabilities(options: StdioMcpOptions): Promise<{ session: StdioMcpSession; tools: readonly ImportableMcpTool[]; capabilities: readonly Capability[] }> {
  const session = new StdioMcpSession(options);
  try {
    const tools = await session.listTools();
    const capabilities = capabilitiesFromMcpTools(tools, {
      namespace: options.namespace,
      version: options.version,
      callTool: (name, input) => session.callTool(name, input),
      baseEffects: ["process.spawn", "environment.read"],
      effectsComplete: options.effectsComplete,
      transport: "stdio"
    });
    return { session, tools, capabilities };
  } catch (error) {
    session.close();
    throw error;
  }
}
