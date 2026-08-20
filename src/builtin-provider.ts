import type { Capability } from "./types.js";
import { providerFromCapabilities, type AbilityProvider } from "./need.js";
import authorityEnvelope from "./builtins/capability-authority-envelope.js";
import contractEvolution from "./builtins/capability-contract-evolution.js";
import contractRouter from "./builtins/capability-contract-router.js";
import dominanceResolver from "./builtins/capability-dominance-resolver.js";
import failureFrontier from "./builtins/capability-failure-frontier.js";
import noveltyRadar from "./builtins/capability-novelty-radar.js";
import receiptDrift from "./builtins/capability-receipt-drift.js";
import substitutionCertificate from "./builtins/capability-substitution-certificate.js";
import dataSha256 from "./builtins/data-sha256.js";
import jsonGet from "./builtins/json-get.js";
import textNormalize from "./builtins/text-normalize.js";
import textSlugify from "./builtins/text-slugify.js";

export const builtinCapabilities: readonly Capability<any, any>[] = Object.freeze([
  textNormalize,
  textSlugify,
  dataSha256,
  jsonGet,
  authorityEnvelope,
  contractEvolution,
  contractRouter,
  dominanceResolver,
  failureFrontier,
  noveltyRadar,
  receiptDrift,
  substitutionCertificate
]);

export function createBuiltinProvider(options: { id?: string; priority?: number } = {}): AbilityProvider {
  return providerFromCapabilities({
    id: options.id ?? "capability/builtins",
    kind: "native",
    priority: options.priority ?? 0,
    description: "Pure built-in Capability abilities shipped with the runtime",
    capabilities: builtinCapabilities,
    trusted: true
  });
}
