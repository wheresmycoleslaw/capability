import type {
  Capability,
  CapabilityDefinition,
  CapabilityInspection,
  LegacyCapabilityDefinition
} from "./types.js";
import { assertValidManifest, manifestFromLegacy } from "./manifest.js";
import { deepFreeze } from "./utils.js";

function isModern<Input, Output>(definition: CapabilityDefinition<Input, Output> | LegacyCapabilityDefinition<Input, Output>): definition is CapabilityDefinition<Input, Output> {
  return "manifest" in definition;
}

export function defineCapability<Input, Output>(definition: CapabilityDefinition<Input, Output> | LegacyCapabilityDefinition<Input, Output>): Capability<Input, Output> {
  const manifest = isModern(definition) ? definition.manifest : manifestFromLegacy(definition);
  assertValidManifest(manifest);
  const execute = isModern(definition) ? definition.execute : async (input: Input) => await definition.execute(input);
  const capability: Capability<Input, Output> = {
    manifest: deepFreeze({ ...manifest }) as Readonly<typeof manifest>,
    execute,
    ...(isModern(definition) && definition.plan ? { plan: definition.plan } : {}),
    ...(isModern(definition) && definition.verify ? { verify: definition.verify } : {}),
    ...(isModern(definition) && definition.rollback ? { rollback: definition.rollback } : {})
  };
  return Object.freeze(capability);
}

export function inspectCapability<Input, Output>(capability: Capability<Input, Output>): CapabilityInspection {
  return deepFreeze({ ...capability.manifest, executable: false }) as CapabilityInspection;
}

export async function runCapability<Input, Output>(capability: Capability<Input, Output>, input: Input): Promise<Output> {
  const now = new Date().toISOString();
  const plan = {
    planId: "direct",
    capability: { id: capability.manifest.id, version: capability.manifest.version },
    input,
    inputHash: "direct",
    effects: capability.manifest.effects ?? [],
    summary: `Directly execute ${capability.manifest.name}`,
    createdAt: now,
    fingerprint: "direct"
  } as const;
  return await capability.execute(input, { manifest: capability.manifest, plan });
}
