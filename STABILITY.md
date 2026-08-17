# Capability 1.x Stability Contract

Capability 1.0 is the first stable compatibility line of the Capability protocol and reference runtime.

The promise is deliberately narrower than “all software is supported.” It is stronger where it matters: developers can build Capability packages, hosts, indexes, bridges and generalized metabolic binders against the 1.x public contracts without expecting those contracts to be casually redesigned underneath them.

## The 1.x promise

Within the 1.x line, Capability will not intentionally make a previously conformant integration fail by:

- removing or renaming a stable package export;
- removing a stable MCP bootstrap tool or changing its meaning incompatibly;
- removing a documented CLI command or changing its core argument/result semantics incompatibly;
- changing the meaning of manifest identity, declared effects, planning, authorization, receipts, provenance, verification or rollback incompatibly;
- allowing a metabolic binder to execute a mutable/unbound artifact where the 1.0 binder contract requires an immutable artifact identity;
- treating incomplete authority as complete;
- removing required evidence or artifact identity from the stable metabolic execution receipt;
- changing a frozen 1.x machine-readable format incompatibly without changing that format's own version;
- weakening the separation between discovery, artifact identity, trust, authorization and isolation.

An incompatible public-contract change requires Capability 2.0.

## Additive evolution remains allowed

The following are compatible 1.x changes when existing behavior remains intact:

- new package exports;
- new optional manifest or receipt fields;
- new built-in capabilities;
- new effect namespaces using `custom:<namespace>`;
- new generalized substrate binders;
- additional discovery catalogs;
- stronger verification and isolation implementations;
- new CLI commands and MCP tools;
- new optional machine-readable formats;
- improved ranking, mining and inference that does not silently upgrade inference into trust.

A stable protocol must remain extensible. 1.0 freezes the load-bearing contracts, not the set of software humanity is allowed to build.

## Package version versus document-format versions

Capability `1.0.0` does **not** mechanically rename every embedded `0.1` format to `1.0`.

Those identifiers are independent wire/document versions. The manifest, index, website discovery, bridge, metabolism and gap formats were already deployed before the package reached 1.0. Capability 1.0 freezes their current semantics into the 1.x compatibility promise rather than performing a cosmetic breaking migration.

The new generalized metabolic binding and registry-level metabolic execution receipt are introduced as stable `1.0` envelopes because they are the principal extension boundary being frozen for third-party binders.

The authoritative version inventory is exposed by `capabilityProtocolInfo()` and recorded in `stability-lock.json`.

## Stable public extension boundary: MetabolicBinder

A 1.x metabolic binding MUST identify:

- `bindingVersion: "1.0"`;
- the registered binder ID and substrate;
- the original locator;
- a non-empty immutable artifact identity;
- binding time;
- authority completeness and effects;
- evidence supporting the binding.

If authority is incomplete, the binding MUST preserve `custom:external.opaque-effects`.

`MetabolicBinderRegistry` enforces these requirements at runtime. Incomplete authority cannot execute through the registry without explicit approval, even if a third-party binder implementation forgets to add its own approval check.

The registry wraps binder execution in a stable `1.0` metabolic receipt containing binder/substrate identity, immutable artifact, authority state, evidence, timing, isolation information and any upstream receipt supplied by the binder.

See `metabolic-binding.schema.json`, `metabolic-execution-receipt.schema.json`, and `CONFORMANCE.md`.

## Stable Capability lifecycle

The 1.x contract preserves the semantic separation of:

```text
DISCOVER
  ↓
RESOLVE
  ↓
VERIFY / BIND ARTIFACT
  ↓
ACQUIRE
  ↓
INSPECT
  ↓
PLAN
  ↓
AUTHORIZE
  ↓
ISOLATE + EXECUTE
  ↓
VERIFY
  ↓
RECEIPT
  ↓
ROLLBACK, when supported
```

For software metabolism the corresponding stable rule is:

```text
NEED
  ↓
DISCOVER SOFTWARE
  ↓
MINE EVIDENCE
  ↓
BIND EXACT ARTIFACT
  ↓
PRESERVE AUTHORITY / UNCERTAINTY
  ↓
AUTHORIZE
  ↓
ISOLATE + EXECUTE
  ↓
RECEIPT
  ↓
REUSE / COMPOSE / GAP
```

These are protocol semantics, not marketing language.

## What 1.0 does not promise

1.0 does not mean:

- every GitHub repository is automatically executable;
- every language or package ecosystem already has a binder;
- artifact hashes prove software is benign;
- repository inference is equivalent to a declared contract;
- Docker is an absolute hostile-code sandbox;
- a discovered external project receives authority automatically;
- a numeric trust or confidence score is cryptographic proof;
- the reference implementation is a mature security boundary for every threat model.

Capability reports concrete metabolic substrate coverage instead of inventing a percentage of “all software.” New substrate coverage should normally be added behind the stable binder boundary rather than by adding project-specific exceptions to core.

## Compatibility lock

`stability-lock.json` records the package exports, MCP bootstrap tools, documented CLI command names and format versions that 1.0 commits to retaining throughout 1.x.

The conformance tests compare the implementation against that lock. The lock is a compatibility floor: future 1.x releases may add surface area but may not silently remove locked surface area.

## Breaking-change process

If a future design genuinely requires violating this contract:

1. document the incompatibility and why an additive extension cannot solve it;
2. provide migration guidance where technically possible;
3. preserve the 1.x behavior in 1.x releases;
4. ship the incompatible protocol/runtime behavior only under a new major version.

That is what `1.0.0` means here: not that Capability will stop evolving, but that the architecture has a public load-bearing boundary we are willing to keep stable while it does.
