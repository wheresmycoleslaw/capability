import { CapabilityHub, DEFAULT_CAPABILITY_INDEX_URL } from "./ecosystem.js";
import { assessNativeIntentFit } from "./forge.js";
import { contractsCompose, createCapabilityGap, type CapabilityGap } from "./metabolism.js";
import type { CapabilityEffect, CapabilityManifest, CapabilityReceipt, ExecutionOptions } from "./types.js";
import type { PublicIndexResult } from "./public-index.js";

export type IntentCompositionStep = {
  intent: string;
  id: string;
  package: string;
  score: number;
  manifest: CapabilityManifest;
};

export type IntentCompositionPlan = {
  compositionVersion: "0.1";
  intent: string;
  parts: string[];
  steps: IntentCompositionStep[];
  effects: CapabilityEffect[];
  reasons: string[];
  compositeManifest: CapabilityManifest;
};

export type IntentCompositionResult = {
  intent: string;
  route: "composition" | "gap";
  plan?: IntentCompositionPlan;
  gap?: CapabilityGap;
  outputs?: unknown[];
  receipts?: CapabilityReceipt[];
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "pipeline";
}

export function splitPipelineIntent(intent: string): string[] {
  return intent
    .split(/\s+(?:and\s+then|then)\s+|\s*(?:->|→|\|>)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function candidateStep(intent: string, entry: PublicIndexResult): IntentCompositionStep {
  return {
    intent,
    id: entry.capability.manifest.id,
    package: `${entry.package.name}@${entry.package.version}`,
    score: entry.score,
    manifest: entry.capability.manifest
  };
}

function fit(intent: string, entry: PublicIndexResult): boolean {
  const assessment = assessNativeIntentFit(intent, {
    id: entry.capability.manifest.id,
    name: entry.capability.manifest.name,
    description: entry.capability.manifest.description
  });
  return assessment.accepted;
}

function compatible(previous: IntentCompositionStep, next: IntentCompositionStep) {
  return contractsCompose(previous.manifest.output as Record<string, unknown> | undefined, next.manifest.input as Record<string, unknown> | undefined);
}

function buildPlan(intent: string, parts: string[], steps: IntentCompositionStep[]): IntentCompositionPlan {
  const reasons: string[] = [];
  for (let i = 0; i < steps.length - 1; i += 1) {
    const check = compatible(steps[i]!, steps[i + 1]!);
    reasons.push(`${steps[i]!.id} → ${steps[i + 1]!.id}: ${check.reason}`);
  }
  const effects = [...new Set(steps.flatMap((step) => step.manifest.effects ?? []))] as CapabilityEffect[];
  const deterministic = steps.every((step) => step.manifest.behavior?.deterministic === true);
  const idempotent = steps.every((step) => step.manifest.behavior?.idempotent === true);
  const first = steps[0]!, last = steps[steps.length - 1]!;
  const compositeManifest: CapabilityManifest = {
    specVersion: "0.1",
    id: `composed/${slug(intent)}`,
    version: "0.0.0-synthesized",
    name: `Composed: ${parts.join(" → ")}`,
    description: `Synthesized Capability pipeline for: ${intent}`,
    ...(first.manifest.input ? { input: first.manifest.input } : {}),
    ...(last.manifest.output ? { output: last.manifest.output } : {}),
    effects,
    behavior: { deterministic, idempotent, reversible: false },
    tags: ["composed", "runtime-synthesized"],
    metadata: {
      synthesized: true,
      compositionVersion: "0.1",
      steps: steps.map((step) => ({ id: step.id, package: step.package, intent: step.intent }))
    }
  };
  return { compositionVersion: "0.1", intent, parts, steps, effects, reasons, compositeManifest };
}

export async function planIntentComposition(intent: string, options: { indexes?: readonly string[]; limitPerStep?: number; maxCombinations?: number } = {}): Promise<IntentCompositionResult> {
  const parts = splitPipelineIntent(intent);
  if (parts.length < 2) {
    return { intent, route: "gap", gap: createCapabilityGap(intent, { compositionAttempts: ["Intent does not contain an explicit pipeline boundary such as 'then' or '->'."] }) };
  }
  const hub = new CapabilityHub({ indexes: options.indexes ?? [DEFAULT_CAPABILITY_INDEX_URL] });
  const choices: IntentCompositionStep[][] = [];
  for (const part of parts) {
    const discovered = await hub.discover({ text: part, limit: options.limitPerStep ?? 6 });
    const filtered = discovered.filter((entry) => fit(part, entry)).map((entry) => candidateStep(part, entry));
    choices.push(filtered.length ? filtered : discovered.slice(0, 3).map((entry) => candidateStep(part, entry)));
  }
  if (choices.some((group) => group.length === 0)) {
    return { intent, route: "gap", gap: createCapabilityGap(intent, { compositionAttempts: choices.map((group, index) => `${parts[index]}: ${group.length} candidates`) }) };
  }

  const combinations: IntentCompositionStep[][] = [];
  const maxCombinations = options.maxCombinations ?? 200;
  const walk = (index: number, path: IntentCompositionStep[]) => {
    if (combinations.length >= maxCombinations) return;
    if (index === choices.length) { combinations.push([...path]); return; }
    for (const candidate of choices[index]!) {
      if (path.length && !compatible(path[path.length - 1]!, candidate).compatible) continue;
      walk(index + 1, [...path, candidate]);
      if (combinations.length >= maxCombinations) break;
    }
  };
  walk(0, []);
  if (!combinations.length) {
    return {
      intent,
      route: "gap",
      gap: createCapabilityGap(intent, {
        compositionAttempts: choices.flatMap((group, index) => group.map((step) => `${parts[index]} -> ${step.id}`))
      })
    };
  }
  combinations.sort((a, b) => b.reduce((sum, step) => sum + step.score, 0) - a.reduce((sum, step) => sum + step.score, 0));
  return { intent, route: "composition", plan: buildPlan(intent, parts, combinations[0]!) };
}

export async function executeIntentComposition(plan: IntentCompositionPlan, input: unknown, options: ExecutionOptions & { indexes?: readonly string[] } = {}): Promise<IntentCompositionResult> {
  const hub = new CapabilityHub({ indexes: options.indexes ?? [DEFAULT_CAPABILITY_INDEX_URL] });
  let value: unknown = input;
  const outputs: unknown[] = [];
  const receipts: CapabilityReceipt[] = [];
  for (const step of plan.steps) {
    const execution = await hub.run(step.id, value, options);
    receipts.push(execution.receipt);
    value = execution.receipt.output;
    outputs.push(value);
  }
  return { intent: plan.intent, route: "composition", plan, outputs, receipts };
}

export async function composeIntent(intent: string, options: ExecutionOptions & { input?: unknown; indexes?: readonly string[] } = {}): Promise<IntentCompositionResult> {
  const planned = await planIntentComposition(intent, { indexes: options.indexes });
  if (planned.route !== "composition" || !planned.plan || options.input === undefined) return planned;
  return executeIntentComposition(planned.plan, options.input, options);
}
