import { need, type AbilityProviderRegistry, type NeedOptions, type NeedResolution } from "./need.js";

export const AMBIENT_AGENT_INSTRUCTIONS = [
  "Treat Capability as an ambient missing-ability layer, not as a user-facing destination.",
  "Use the agent's already-prepared tools and providers first.",
  "When the current environment lacks an ability required to finish the user's request, ask Capability for that outcome without requiring the user to mention Capability.",
  "Keep successful discovery and low-risk execution in the background.",
  "Surface Capability only when explicit approval, consequential authority, or an unresolved gap requires user involvement."
].join(" ");

export type AmbientVisibility = "silent" | "surface";
export type AmbientState = "executed" | "resolved" | "approval_required" | "unresolved";

export type AmbientResolution = {
  mode: "ambient-fallback";
  state: AmbientState;
  visibility: AmbientVisibility;
  requiresUserAction: boolean;
  intent: string;
  resolution?: NeedResolution;
  approval?: {
    code: "APPROVAL_REQUIRED";
    message: string;
  };
  guidance: string;
};

export type AmbientLayerOptions = Omit<NeedOptions, "execute" | "approved" | "input"> & {
  /** Automatically execute abilities that Capability can run without explicit approval. Defaults to true. */
  autoExecute?: boolean;
};

export type AmbientRequestOptions = Omit<NeedOptions, "providers" | "execute"> & {
  /** Per-request prepared providers override the layer-level registry when supplied. */
  providers?: AbilityProviderRegistry;
  /** Override layer-level automatic execution for this request. */
  autoExecute?: boolean;
};

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withoutExecution(options: AmbientLayerOptions | AmbientRequestOptions): NeedOptions {
  const { autoExecute: _autoExecute, ...rest } = options;
  return rest;
}

/**
 * Agent-facing fallback layer for environments that should not expose Capability as
 * a normal end-user workflow.
 *
 * The host agent calls `resolveMissing()` only after its ordinary tool/router path
 * cannot satisfy an outcome. Capability then prefers prepared providers, resolves
 * the wider software world when needed, silently executes only when no explicit
 * approval is required, and turns approval boundaries into structured control
 * flow instead of leaking infrastructure details into the conversation.
 */
export class AmbientCapabilityLayer {
  readonly mode = "ambient-fallback" as const;
  private readonly options: AmbientLayerOptions;

  constructor(options: AmbientLayerOptions = {}) {
    this.options = options;
  }

  async resolveMissing(intent: string, request: AmbientRequestOptions = {}): Promise<AmbientResolution> {
    if (!intent.trim()) throw new TypeError("intent is required");

    const merged: NeedOptions = {
      ...withoutExecution(this.options),
      ...withoutExecution(request),
      ...(request.providers ? { providers: request.providers } : this.options.providers ? { providers: this.options.providers } : {}),
      execute: false,
      approved: request.approved ?? false,
      ...(request.input !== undefined ? { input: request.input } : {})
    };

    const resolution = await need(intent, merged);
    if (resolution.status === "unresolved") {
      return {
        mode: this.mode,
        state: "unresolved",
        visibility: "surface",
        requiresUserAction: false,
        intent,
        resolution,
        guidance: "The agent may explain that no defensible ability was resolved; do not invent success."
      };
    }

    const autoExecute = request.autoExecute ?? this.options.autoExecute ?? true;
    if (!autoExecute) {
      return {
        mode: this.mode,
        state: "resolved",
        visibility: "silent",
        requiresUserAction: false,
        intent,
        resolution,
        guidance: "Keep Capability in the background and continue the agent workflow with the resolved ability."
      };
    }

    // Discovery of external software is not authority to run it. Only ask need() to
    // execute a candidate already represented as execution-ready. This keeps ambient
    // mode from turning ordinary fallback into silent arbitrary-software execution.
    if (resolution.candidate?.executionReady === false) {
      return {
        mode: this.mode,
        state: "resolved",
        visibility: "silent",
        requiresUserAction: false,
        intent,
        resolution,
        guidance: "A candidate was discovered but is not execution-ready. Keep discovery internal and continue through an explicit materialization or execution boundary."
      };
    }

    try {
      const executed = await need(intent, {
        ...merged,
        execute: true,
        approved: request.approved ?? false
      });
      if (executed.status === "executed") {
        return {
          mode: this.mode,
          state: "executed",
          visibility: "silent",
          requiresUserAction: false,
          intent,
          resolution: executed,
          guidance: "Use the result to continue the user's task without narrating Capability as a separate product step."
        };
      }
      return {
        mode: this.mode,
        state: executed.status === "unresolved" ? "unresolved" : "resolved",
        visibility: executed.status === "unresolved" ? "surface" : "silent",
        requiresUserAction: false,
        intent,
        resolution: executed,
        guidance: executed.status === "unresolved"
          ? "No executable route was resolved; do not claim completion."
          : "Keep Capability in the background and continue through the resolved route."
      };
    } catch (error) {
      if (errorCode(error) === "APPROVAL_REQUIRED") {
        return {
          mode: this.mode,
          state: "approval_required",
          visibility: "surface",
          requiresUserAction: true,
          intent,
          resolution,
          approval: {
            code: "APPROVAL_REQUIRED",
            message: errorMessage(error)
          },
          guidance: "Surface the consequential action and ask for explicit approval. Do not auto-approve on the user's behalf."
        };
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.options.providers?.close();
  }
}

export function createAmbientCapabilityLayer(options: AmbientLayerOptions = {}): AmbientCapabilityLayer {
  return new AmbientCapabilityLayer(options);
}

/** Functional shorthand for one-off agent fallback calls. */
export async function resolveMissingAbility(intent: string, options: AmbientRequestOptions = {}): Promise<AmbientResolution> {
  return new AmbientCapabilityLayer().resolveMissing(intent, options);
}
