export type CapabilityEffects = {
  filesystem?: {
    read?: boolean;
    write?: boolean;
  };
  network?: boolean;
  shell?: boolean;
  environment?: boolean;
};

export type CapabilityBehavior = {
  deterministic?: boolean;
  idempotent?: boolean;
  reversible?: boolean;
};

export type CapabilityDefinition<Input = unknown, Output = unknown> = {
  name: string;
  description: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  effects?: CapabilityEffects;
  behavior?: CapabilityBehavior;
  execute: (input: Input) => Output | Promise<Output>;
};

export type CapabilityInspection = {
  name: string;
  description: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  effects: CapabilityEffects;
  behavior: CapabilityBehavior;
};

export function defineCapability<Input, Output>(
  definition: CapabilityDefinition<Input, Output>
): Readonly<CapabilityDefinition<Input, Output>> {
  return Object.freeze(definition);
}

export function inspectCapability<Input, Output>(
  capability: CapabilityDefinition<Input, Output>
): CapabilityInspection {
  return {
    name: capability.name,
    description: capability.description,
    input: capability.input,
    output: capability.output,
    effects: capability.effects ?? {},
    behavior: capability.behavior ?? {}
  };
}

export async function runCapability<Input, Output>(
  capability: CapabilityDefinition<Input, Output>,
  input: Input
): Promise<Output> {
  return await capability.execute(input);
}
