# Capability Standard

**Protocol stability line:** 1.x  
**Protocol version:** 1.0  
**Reference implementation:** 1.0.x  
**Status:** Stable public contract; security-sensitive reference runtime

Capability defines a portable unit of executable functionality and a generalized mechanism by which software agents can discover, understand, bind, authorize, isolate, execute, verify, receipt, compose, and acquire abilities from both Capability-native and existing software.

The 1.x compatibility promise is defined in [STABILITY.md](./STABILITY.md). Structural conformance is defined in [CONFORMANCE.md](./CONFORMANCE.md).

## Core invariants

Capability 1.x treats the following as separate claims:

```text
DISCOVERY ≠ TRUST
ARTIFACT IDENTITY ≠ SAFETY
TRUST ≠ AUTHORIZATION
AUTHORIZATION ≠ ISOLATION
INFERENCE ≠ DECLARED FACT
```

A host MUST NOT infer authorization merely because software was discovered, downloaded, hashed, signed, highly ranked, or successfully executed before.

## Lifecycle

For native Capability packages:

```text
DISCOVER -> RESOLVE -> VERIFY/BIND -> ACQUIRE -> INSPECT -> PLAN -> AUTHORIZE -> ISOLATE/EXECUTE -> VERIFY -> RECEIPT
                                                                                                           |
                                                                                                       ROLLBACK
```

For existing software:

```text
NEED -> DISCOVER SOFTWARE -> MINE EVIDENCE -> BIND EXACT ARTIFACT -> PRESERVE AUTHORITY/UNCERTAINTY -> AUTHORIZE -> ISOLATE/EXECUTE -> RECEIPT -> REUSE/COMPOSE/GAP
```

The first flow and the second flow converge on the same principles: executable code must be tied to an exact identity before execution, authority remains host-controlled, isolation is explicit, and execution leaves evidence.

## Independent format versions

Capability package/protocol version `1.0` does not rename every previously deployed document format.

The 1.x stability line freezes the currently deployed manifest, index, site-discovery, bridge, metabolism and gap formats at their existing document versions. Those version fields evolve independently when their wire formats actually change.

`capabilityProtocolInfo()` exposes the authoritative inventory.

## Capability manifest

A compliant manifest MUST expose:

- `specVersion`;
- stable namespaced `id`;
- semantic capability `version`;
- `name`;
- `description`.

It SHOULD expose JSON Schema for `input` and `output`, declared `effects`, behavioral properties and discovery tags.

The stable manifest document version for Capability 1.x begins at `0.1`. `capability-manifest.schema.json` is the machine-readable schema.

Capability IDs match:

```text
^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)+$
```

## Effects and authority

Built-in effects are:

```text
filesystem.read
filesystem.write
network.connect
process.spawn
environment.read
secrets.read
database.read
database.write
email.send
git.commit
git.push
```

Extensions MUST use `custom:<namespace>`.

A plan MAY narrow declared effects but MUST NOT add undeclared effects. Declaring an effect does not authorize it.

External software whose complete effect surface is not defensibly known MUST preserve uncertainty with `custom:external.opaque-effects` at the relevant binding/contract boundary.

## Inspection

Inspection MUST NOT execute capability code and MUST NOT expose its executable function.

For package acquisition, safely inspectable packages provide inert manifest metadata before executable modules are loaded.

Repository mining is evidence gathering. A mined candidate is not a trusted executable capability merely because the miner found an export, test, route, README section, or high-confidence semantic match.

## Planning

A plan binds capability ID/version, structured input, input hash, requested effects, summary, creation time, optional plan data and an integrity fingerprint.

A runtime MUST reject a plan when bound input or integrity state has changed after planning.

For module-backed capabilities acquired through an isolation boundary, planning hooks SHOULD execute through the same class of boundary as execution.

## Authorization

Authorization belongs to the host runtime.

Deny rules take precedence over allow/approval rules in the reference policy. Declared effects are denied by default unless policy allows them.

External metabolic bindings with incomplete authority require explicit approval at the common `MetabolicBinderRegistry` boundary in the reference implementation. Substrate-specific binders and hosts may require stronger controls.

## Validation and execution

Inputs SHOULD be validated before execution and outputs SHOULD be validated afterward against declared schemas.

Execution isolation is host-defined. A host MAY use in-process execution only for code it explicitly treats as trusted. Ecosystem software SHOULD execute across a process/container/VM/WASM/remote boundary appropriate to the host threat model.

The specification does not claim that Docker, Node permissions, WASM, VMs, signatures, provenance systems, or any one mechanism is universally sufficient containment for hostile code.

## Verification

A capability MAY define a verification hook. Failed verification makes execution fail and is reflected in its receipt.

For isolated module-backed capabilities, verification SHOULD remain inside the selected isolation boundary.

Verification of artifact identity and verification of semantic correctness are different operations.

## Receipts

Native Capability execution attempts produce receipts containing capability/plan identity, status, timing, effects, hashes, optional values, verification, errors and observed provenance. `capability-receipt.schema.json` documents the stable machine-readable envelope.

Metabolic binder execution through the 1.x registry additionally emits a substrate-neutral `MetabolicExecutionReceipt` version `1.0` containing:

- binder/substrate identity;
- original locator;
- immutable artifact identity;
- authority state;
- binding evidence;
- status and timing;
- optional isolation label;
- optional substrate-specific upstream receipt.

See `metabolic-execution-receipt.schema.json`.

## Rollback

Rollback requires a successful receipt, reversible behavior declaration, an implementation, and authorization for the relevant effects.

A rollback mechanism MUST NOT be assumed merely because a capability is idempotent.

## Discovery

Discovery SHOULD operate on inert metadata when available.

Capability supports:

- native/federated Capability indexes;
- website bootstrap through the experimental `/.well-known/capabilities` convention;
- npm and GitHub software-world candidates;
- arbitrary GitHub repository evidence mining;
- OpenAPI operation import;
- MCP server/tool import;
- generalized metabolic substrate binders.

External search results remain candidates until a defensible binding/adapter exists.

## Package convention

An npm package MAY advertise capabilities through `package.json.capability`.

For safe pre-execution acquisition, each export uses a package-relative module path plus the complete inert manifest and may carry module integrity.

The imported implementation manifest MUST match the inert package manifest.

Legacy string-only exports remain a compatibility path but are not sufficient for safe ecosystem acquisition.

## Public indexes and federation

A public index is a static JSON document containing exact package versions, source metadata and inert capability descriptors.

Indexes MAY federate to other HTTP(S) indexes. Federation does not imply trust. Clients SHOULD bound traversal depth/count, validate each document and de-duplicate visited URLs.

Resolution MUST select exact capability/package versions before acquisition. Reproducible deployments SHOULD persist a lockfile or equivalent immutable selection record.

## Artifact verification and acquisition

Installation alone does not establish trust.

A client MAY require registry signatures, package integrity, repository/commit metadata and provenance attestations.

Observed artifact integrity MUST NOT be silently replaced by index-supplied integrity. A mismatch MUST fail acquisition.

Safe acquisition MUST NOT import executable package code into the host process before the selected isolation boundary.

## Metabolic binder contract

A `MetabolicBinder` generalizes adaptation by execution substrate rather than by individual project.

A conformant executable binding MUST provide the stable `MetabolicBinding` version `1.0` envelope with:

- binder ID;
- substrate;
- discovery locator;
- exact immutable artifact identity;
- binding timestamp;
- authority completeness/effects;
- non-empty evidence.

Incomplete authority MUST contain `custom:external.opaque-effects`.

The reference registry validates a binding both after `bind()` and before `execute()`.

A mutable discovery locator is not sufficient as `immutableArtifact` merely because the binder intends to resolve it later.

See [BINDERS.md](./BINDERS.md), `metabolic-binding.schema.json`, and [CONFORMANCE.md](./CONFORMANCE.md).

## Repository mining and Forge

Repository mining resolves an exact source revision and may correlate manifests, source declarations, docs, tests, examples, routes and visible effect signals.

Mined operations remain evidence-backed candidates and authority-incomplete unless a stronger contract is available.

Forge may convert a selected candidate into a private executable Capability when a real binder can tie the operation to an exact executable artifact. Unsupported repository surfaces remain non-executable rather than being promoted through guesswork.

## Composition

Composed capabilities declare the union of required effects across steps.

A composer SHOULD reject known schema contradictions rather than fabricate conversion steps. Runtime pipelines SHOULD preserve per-step authorization, provenance and receipts.

Composition creates a new usable ability from compatible operations; it does not erase the trust/authority properties of the underlying steps.

## Capability gaps

When discovery and composition cannot defensibly satisfy an outcome, a host MAY emit a machine-readable Capability gap describing the unresolved intent, desired contracts, authority ceiling, verification requirements and search evidence.

A gap is a specification for missing software, not a claim that the software exists.

## OpenAPI interoperability

OpenAPI operations MAY become Capability contracts. Network access remains an explicit effect and host authorization remains authoritative.

## MCP interoperability

Capabilities MAY be projected as MCP tools, and existing MCP servers MAY be imported conservatively as Capability contracts.

MCP annotations are hints; they do not replace Capability authorization or substrate-specific trust decisions.

The Capability MCP bootstrap exposes discovery itself rather than requiring an agent to preload every possible ability.

## Conformance

Structural 1.x conformance is executable.

`runProtocolConformance()` checks the stable reference contracts without network access. `runBinderConformance()` exercises third-party substrate binders through the public registry boundary.

Passing structural conformance does not prove an artifact benign, an inference semantically correct, or an isolation mechanism sufficient for a particular threat model.

## Compatibility

Capability 1.x follows the stability rules in `STABILITY.md`.

Additive extension is expected. Removal, incompatible renaming, weakening of the stable authority/artifact invariants, or incompatible change to locked public contracts requires a new major version.
