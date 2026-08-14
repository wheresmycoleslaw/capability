# Adoption Guide

Capability is only useful as a standard if a developer who did not build it can publish a safe, discoverable ability without learning the internals first.

## Zero to capability

Create a project:

```bash
npx @wheresmycoleslaw/capability create my-capability --id my-domain/my-ability
cd my-capability
npm install
npm test
npm run readiness
npm run novelty
```

The generated project contains:

- a complete inert capability manifest;
- a TypeScript implementation;
- a test that prevents executable/package manifest drift;
- packaging checks;
- CI;
- a tokenless npm trusted-publishing workflow for releases after the first publish;
- registry-entry generation;
- novelty analysis against the live Capability federation.

## What to build

The ecosystem does not need another wrapper around a function that already exists. A capability contribution should create a materially new useful outcome, a substantially safer authority profile, a new compositional contract, or a meaningfully better execution property.

Before publishing:

```bash
npm run novelty
```

The novelty radar compares the proposed contract against the currently reachable Capability network. It considers purpose language, input and output contracts, declared effects, and tags. It classifies the proposal as a functional twin, incremental variation, distinct design, or novel contribution.

A functional-twin result is a design warning, not a game to beat by renaming fields. If the new package does not create a meaningful new capability, improve the existing one or design something else.

## Readiness

```bash
npm run readiness
```

Readiness checks the parts that matter before public adoption:

- valid inert manifests;
- explicit effects, including an explicit empty list for effect-free code;
- behavior declarations;
- tests and packaging checks;
- repository and license metadata;
- CI and publishing workflow presence.

Warnings do not necessarily block publication. Failures indicate that the package is not safe for the normal discovery path.

## First npm publish

npm requires a package to exist before a trusted publisher can be attached. Publish the first version interactively:

```bash
npm login
npm publish --access public
```

Then configure npm Trusted Publishing for the package using the generated `.github/workflows/publish.yml`. Future releases can use short-lived GitHub OIDC credentials and do not need a permanent npm write token.

## Join discovery

Generate the exact static registry record:

```bash
npm run registry-entry
```

You can then either:

1. add that record to your own Capability index and federate it; or
2. submit it to an existing index.

Capability indexes are discovery metadata, not trust roots. Clients still verify the exact package artifact before execution.

## Design for least authority

Declare only effects the capability may actually use. Capability 0.4 adds `capability/authority-envelope`, which can inspect a planned set of capabilities and expose excess authority before execution.

A useful design goal is not merely "works." It is:

> achieves the outcome with the smallest authority surface, clearest contract, strongest verification, and safest failure behavior practical.

## Design for composition

`capability/contract-router` compares an upstream output contract to downstream input contracts and identifies deterministic safe routes. This means package authors can make their capability more composable by using precise, stable schemas rather than vague payloads.

## Design for failure

`capability/failure-frontier` identifies the first irreversible mutation in a multi-step plan, the actions that deserve approval checkpoints, how much of the mutating path has compensation, and how much of the prefix can be safely retried.

This is a different design target from ordinary plugin systems: a capability should make its failure semantics legible before the agent acts.

## Design for reproducibility

`capability/receipt-drift` compares execution receipts and can flag the especially important case where the same input produces a different output under an apparently stable capability, as well as effect or supply-chain drift.

## Design for safe replacement

Dynamic discovery creates a problem ordinary package managers do not answer: two abilities can look interchangeable while one silently requires more authority, drops an output guarantee, weakens determinism, or comes from a weaker trust posture.

`capability/substitution-certificate` evaluates a proposed replacement across those dimensions and emits a deterministic certificate only when the conservative substitution check passes. A replacement may reduce authority; it may not silently expand it.

For programmatic use:

```ts
import { certifyCapabilitySubstitution } from "@wheresmycoleslaw/capability/evolution";

const certificate = certifyCapabilitySubstitution(original, replacement, originalTrust, replacementTrust);
if (!certificate.accepted) {
  // do not hot-swap this ability automatically
}
```

## Design for capability evolution

Ordinary semantic versioning mostly describes API compatibility. Capability contracts also contain authority and behavioral promises.

`capability/contract-evolution` classifies a new version as a safe patch, authority-reducing change, review-required change, or breaking change. It recommends patch/minor/major while considering input/output guarantees, effects, determinism, idempotence, and reversibility.

This lets an ecosystem distinguish a harmless implementation fix from a version that suddenly needs network access even when its function signature looks unchanged.

## Design for selection without hiding tradeoffs

`capability/dominance-resolver` computes the non-dominated frontier among interchangeable candidates using authority risk, trust, determinism, and reversibility. It deliberately does not collapse those dimensions into one magic score.

If one candidate is strictly worse than another on all of those dimensions, it can be removed from consideration. If two candidates represent a real tradeoff, both remain visible for the host or agent policy to choose between.

## The adoption test

Capability has crossed from project to standard when independently authored packages and independently hosted indexes interoperate without changes to the runtime.

The practical target is:

1. create a package with the scaffolder;
2. publish it independently;
3. expose it through an independent index;
4. federate that index;
5. discover it from a fresh machine;
6. verify and acquire the exact artifact;
7. execute it in isolation;
8. receive a valid receipt;
9. do all of the above without adding special-case code to Capability itself.
