# Capability 1.x Conformance

Capability 1.0 turns the public extension boundary into something testable.

Conformance is not a badge for “the code ran once.” A conformant integration must preserve the protocol's identity, authority, evidence and execution boundaries even when doing so is inconvenient.

## Reference protocol conformance

The package exports:

```ts
import {
  runProtocolConformance,
  assertProtocolConformance
} from "@wheresmycoleslaw/capability/conformance";
```

`runProtocolConformance()` performs a network-free reference check of the stable 1.x contracts:

- protocol/version inventory;
- inert manifest validation;
- public index validation;
- website discovery document validation;
- immutable metabolic binding validation;
- central approval enforcement for incomplete authority;
- stable registry-level metabolic execution receipts that retain artifact identity, authority and evidence.

`assertProtocolConformance()` throws if any reference check fails.

The repository test suite runs these checks on every supported Node line before release.

## Third-party binder conformance

A generalized substrate binder should be tested through the public registry rather than by calling its implementation directly:

```ts
import {
  METABOLIC_BINDING_VERSION,
  runBinderConformance,
  type MetabolicBinder
} from "@wheresmycoleslaw/capability";

const binder: MetabolicBinder<{ ref: string }> = {
  id: "example/wasm-component",
  substrate: "wasm",
  discovery: "explicit",
  description: "Bind a WASM component by content digest.",

  async bind(request) {
    return {
      bindingVersion: METABOLIC_BINDING_VERSION,
      binderId: this.id,
      substrate: this.substrate,
      locator: request.ref,
      immutableArtifact: "sha256:...",
      createdAt: new Date().toISOString(),
      authority: {
        complete: false,
        effects: ["custom:external.opaque-effects"]
      },
      evidence: ["registry-signature:...", "sha256:..."]
    };
  },

  async execute(binding, input) {
    return {
      status: "succeeded",
      output: { ok: true },
      isolation: "wasm-component-runtime"
    };
  }
};

const report = await runBinderConformance(
  binder,
  { ref: "example.wasm" },
  { executeInput: {}, approved: true }
);

if (!report.ok) throw new Error(JSON.stringify(report, null, 2));
```

## Mandatory binder properties

A binder is not conformant unless its binding:

1. identifies the binder and substrate;
2. records the original locator;
3. resolves that locator to a non-empty immutable artifact identity before execution;
4. records when the binding was created;
5. preserves evidence supporting the binding;
6. truthfully records whether the authority surface is complete;
7. preserves `custom:external.opaque-effects` whenever authority is incomplete.

The registry validates these rules on both `bind()` and `execute()`.

That means a third-party binder cannot obtain a conformant execution simply by returning a convenient mutable package tag or URL and promising to resolve it later.

## Central approval invariant

Incomplete authority is a protocol state, not a UI hint.

`MetabolicBinderRegistry.execute()` refuses to invoke a binder whose binding has `authority.complete === false` unless the caller supplied explicit approval. This check lives outside the binder implementation so a binder cannot accidentally bypass the invariant by forgetting its own guard.

Hosts may impose stricter policy. They may not treat the registry check as evidence that the software is safe.

## Stable metabolic receipt

Every binder execution attempted through the registry receives a `1.0` envelope containing:

- binder ID;
- substrate;
- original locator;
- immutable artifact identity;
- status and timing;
- authority completeness/effects;
- binding evidence;
- isolation label when supplied;
- upstream receipt when supplied;
- optional metadata or error.

The binder's own detailed receipt is preserved rather than replacing the protocol receipt. This gives audit systems a substrate-neutral envelope without throwing away substrate-specific evidence.

## Clean-room extension test

A meaningful extension proof should implement a binder **outside Capability core**, then test it against multiple unrelated artifacts from the same substrate.

Good examples:

- one WASM binder against three unrelated components;
- one Rust binary binder against unrelated crates/releases;
- one JVM binder against unrelated JARs;
- one .NET binder against unrelated assemblies;
- one signed-native-package binder against unrelated packages.

A project-specific `if repo === X` special case is an integration, not a generalized metabolic binder.

## Security conformance is not protocol conformance

Passing the conformance suite proves structural compatibility with the 1.x contracts. It does **not** prove:

- that an artifact is benign;
- that authority inference is complete;
- that an isolation technology contains every exploit;
- that the operation satisfies a human's intent;
- that upstream provenance is trustworthy;
- that a binder's semantic inference is correct.

Those properties require evidence, policy, threat-model-specific isolation and evaluation beyond structural protocol conformance.

## Versioning

The binding envelope and registry-level metabolic execution receipt are version `1.0` for the Capability 1.x stability line.

If a future release can extend them additively, it should do so without breaking existing fields. If an incompatible change is unavoidable, it belongs in a new protocol major version rather than being smuggled into 1.x.
