# Capability Standard

**Specification version:** 0.1  
**Status:** Experimental

## Purpose

Capability defines a portable unit of executable functionality that an agent or runtime can discover, inspect, plan, authorize, execute, verify, record, compose, and where supported, roll back.

```text
DISCOVER -> INSPECT -> PLAN -> AUTHORIZE -> EXECUTE -> VERIFY -> RECEIPT
```

The standard separates a capability's declared contract from host authorization and execution policy.

## Manifest

A compliant capability MUST expose `specVersion`, a stable namespaced `id`, semantic `version`, `name`, and `description`. It SHOULD expose JSON Schema for `input` and `output`, declared `effects`, behavioral properties, and discovery tags. `capability-manifest.schema.json` is the machine-readable schema.

## Identity

Capability IDs MUST be namespaced and match:

```text
^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)+$
```

Plans bind both capability ID and version.

## Effects

Built-in effects are `filesystem.read`, `filesystem.write`, `network.connect`, `process.spawn`, `environment.read`, `secrets.read`, `database.read`, `database.write`, `email.send`, `git.commit`, and `git.push`. Extensions MUST use `custom:<namespace>`.

A plan MAY narrow declared effects but MUST NOT add undeclared effects.

## Inspection

Inspection MUST NOT execute capability code and MUST NOT expose its executable function.

## Planning

A plan binds capability ID/version, structured input, input hash, requested effects, summary, creation time, optional plan data, and an integrity fingerprint. A runtime MUST reject modified plans or modified input after planning.

## Authorization

Authorization belongs to the runtime. The reference policy supports allow, deny, and explicit-approval effect patterns. Deny rules take precedence. The reference runtime denies declared effects by default.

## Validation and execution

Inputs SHOULD be validated before execution and outputs SHOULD be validated after execution. The reference runtime validates a common JSON Schema subset.

## Verification

A capability MAY define a verification hook. Failed verification makes execution fail and is reflected in its receipt.

## Receipts

Execution attempts produce receipts containing receipt/plan IDs, capability identity/version, status, timing, effects, hashes, optional values, verification, errors, and observed provenance. Receipt storage is replaceable.

## Rollback

Rollback requires a successful receipt, `behavior.reversible === true`, a rollback hook, and authorization for the relevant effects.

## Discovery

The reference registry supports lexical discovery over IDs, names, descriptions, and tags. Semantic ranking is pluggable through `DiscoveryRanker` and `EmbeddingRanker`.

## Composition

Composed capabilities MUST declare the union of effects required by their steps. Runtime pipelines MAY preserve per-step planning, authorization, and receipts.

## Package convention

An npm package MAY advertise exported capabilities through `package.json.capability`. Canonical descriptors contain a package-relative module path and the complete inert manifest. The reference acquisition layer verifies that the imported module's manifest matches the inert package metadata and can verify SHA-256 module integrity.

## Public capability indexes

A public index is a static JSON document containing exact package versions, source metadata, and inert capability descriptors. `capability-index.schema.json` defines the reference format. Indexes MAY be independently hosted, cached, merged, and searched before package installation or module import.

## Package installation

The reference npm installer installs the exact version selected by the index with lifecycle scripts disabled. Installation mechanics are replaceable through `CapabilityPackageInstaller`. Installation alone does not establish trust.

## Trust assessment

Trust policy operates on observed provenance. The reference assessment can require package identity, integrity, repository, commit, attestation metadata, allowlists, and a minimum deterministic score. A score or metadata reference is not cryptographic proof; hosts requiring such proof MUST verify it using the issuing ecosystem.

## Evaluations

A runtime MAY execute evaluation cases through the normal capability path. The reference eval harness preserves schema validation, authorization, verification, and receipts. Determinism evaluation compares output hashes across repeated executions.

## OpenAPI interoperability

OpenAPI 3.1 operations MAY be imported as capabilities. The reference adapter synthesizes structured inputs from parameters/request bodies, reads JSON response schemas where available, and declares `network.connect`. Runtime policy remains authoritative.

## MCP interoperability

Capabilities MAY be projected as MCP tools. Schemas become tool schemas; behavior/effects become annotations; capability identity/version remain metadata. MCP annotations are hints and do not replace runtime authorization.

## Isolation

The reference implementation provides an optional Node Permission Model executor for module-backed capabilities. Higher-assurance runtimes SHOULD use a stronger OS/container/VM/WASM/remote boundary for hostile code.

## Compatibility

The 0.x series is experimental. The reference implementation retains the 0.0.x flat `defineCapability()` shape as a compatibility path.
