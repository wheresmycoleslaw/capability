import type { Capability } from "./types.js";
import type { CapabilityRuntime } from "./runtime.js";

export type McpToolDescriptor = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  _meta: { "capability/id": string; "capability/version": string };
};

function toolName(id: string): string { return id.replace(/[^A-Za-z0-9_-]/g, "__").slice(0, 128); }
function isMutating(effect: string): boolean {
  return effect.endsWith(".write") || effect === "email.send" || effect === "git.commit" || effect === "git.push" || effect === "process.spawn";
}

export function toMcpTool(capability: Capability): McpToolDescriptor {
  const effects = capability.manifest.effects ?? [];
  return {
    name: toolName(capability.manifest.id),
    title: capability.manifest.name,
    description: capability.manifest.description,
    inputSchema: capability.manifest.input ?? { type: "object" },
    ...(capability.manifest.output && capability.manifest.output.type === "object" ? { outputSchema: capability.manifest.output } : {}),
    annotations: {
      readOnlyHint: !effects.some(isMutating),
      destructiveHint: effects.some(isMutating),
      idempotentHint: capability.manifest.behavior?.idempotent === true,
      openWorldHint: effects.includes("network.connect")
    },
    _meta: { "capability/id": capability.manifest.id, "capability/version": capability.manifest.version }
  };
}

export function createMcpAdapter(runtime: CapabilityRuntime) {
  const byName = () => new Map(runtime.registry.list().map((capability) => [toolName(capability.manifest.id), capability]));
  return {
    listTools(): { tools: McpToolDescriptor[] } {
      return { tools: runtime.registry.list().map(toMcpTool) };
    },
    async callTool(request: { name: string; arguments?: unknown; approved?: boolean }) {
      const capability = byName().get(request.name);
      if (!capability) return { isError: true, content: [{ type: "text", text: `Unknown capability tool: ${request.name}` }] };
      try {
        const receipt = await runtime.invoke(capability.manifest.id, request.arguments ?? {}, { approved: request.approved });
        return {
          content: [{ type: "text", text: JSON.stringify(receipt.output ?? null) }],
          structuredContent: receipt.output,
          _meta: { receiptId: receipt.receiptId, capabilityId: capability.manifest.id }
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
      }
    }
  };
}
