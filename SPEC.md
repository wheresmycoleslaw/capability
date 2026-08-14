# Capability Standard

**Specification version:** 0.1  
**Reference implementation:** 0.3.x  
**Status:** Experimental

## Purpose

Capability defines a portable unit of executable functionality that software agents and runtimes can discover, inspect, plan, authorize, execute, verify, record, compose and, where supported, roll back.

```text
DISCOVER -> RESOLVE -> ACQUIRE -> INSPECT -> PLAN -> AUTHORIZE -> EXECUTE -> VERIFY -> RECEIPT
                                                                                         |
                                                                                     ROLLBACK
```

The standard separates a capability's declared contract from artifact trust, host authorization and execution isolation.

## Manifest

A compliant capability MUST expose `specVersion`, a stable namespaced `id`, semantic `version`, `name`, and `description`. It SHOULD expose JSON Schema for `input` and `output`, declared `effects`, behavioral properties and discovery tags. `capability-manifest.schema.json` is the machine-readable schema.

## Identity

Capability IDs MUST be namespaced and match:

```text
^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)+$
```

Plans and lockfiles bind capability ID and version.

## Effects

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

## Inspection

Inspection MUST NOT execute capability code and MUST NOT expose its executable function.

For ecosystem acquisition, a package MUST provide an inert manifest in package metadata before its executable module may be considered safely inspectable.

## Planning

A plan binds capability ID/version, structured input, input hash, requested effects, summary, creation time, optional plan data and an integrity fingerprint. A runtime MUST reject modified plans or input after planning.

For module-backed capabilities acquired through an isolation boundary, a planning hook SHOULD execute through the same boundary as execution rather than in the host process.

## Authorization

Authorization belongs to the host runtime. The reference policy supports allow, deny and explicit-approval effect patterns. Deny rules take precedence. The reference runtime denies declared effects by default.

## Validation and execution

Inputs SHOULD be validated before execution and outputs SHOULD be validated after execution. The reference runtime validates a common JSON Schema subset.

Execution isolation is host-defined. A runtime MAY use an in-process executor for trusted code, but ecosystem clients SHOULD prefer a process/container/VM/WASM/remote boundary appropriate to the threat model.

## Verification

A capability MAY define a verification hook. Failed verification makes execution fail and is reflected in its receipt. For isolated module-backed capabilities, verification SHOULD execute through the isolation boundary.

## Receipts

Execution attempts produce receipts containing receipt/plan IDs, capability identity/version, status, timing, effects, hashes, optional values, verification, errors and observed provenance. Receipt storage is replaceable.

## Rollback

Rollback requires a successful receipt, `behavior.reversible === true`, an implementation, and authorization for the relevant effects. For isolated module-backed capabilities, rollback SHOULD execute through the same isolation boundary.

## Discovery

Discovery SHOULD operate on inert metadata. The reference registry supports lexical discovery over IDs, names, descriptions and tags. Semantic ranking is pluggable through `DiscoveryRanker` and `EmbeddingRanker`.

## Package convention

An npm package MAY advertise capabilities through `package.json.capability`.

For safe pre-execution acquisition, each export MUST use a descriptor containing:

- a package-relative `module` path;
- the complete inert `manifest`;
- optional module `integrity`.

The imported implementation manifest MUST match the inert package manifest. A string-only module export remains a compatibility form but is not sufficient for safe ecosystem acquisition.

## Public capability indexes

A public index is a static JSON document containing exact package versions, source metadata and inert capability descriptors. `capability-index.schema.json` defines the reference format.

Indexes MAY contain `federates`: HTTP(S) URLs of other public indexes. Federation does not imply trust. Clients SHOULD bound traversal depth and index count, validate each index and de-duplicate visited URLs.

Indexes SHOULD be searchable before package installation or module import.

## Resolution

A resolver MUST return an exact package version and exact capability version before acquisition. The reference resolver prefers the newest semantic capability version for an exact ID, then the newest containing package version.

Production clients SHOULD use a lockfile or equivalent immutable selection record when reproducibility matters.

## Package installation

The reference npm installer installs the exact selected package version with lifecycle scripts disabled. Installation mechanics are replaceable through `CapabilityPackageInstaller`.

Installation alone does not establish trust.

## Artifact verification

A client MAY require registry signatures, package integrity, source repository metadata, source commit data and provenance attestations.

The reference strict npm path delegates signature and provenance verification to npm, records the results as observed provenance, and rejects acquisition when configured requirements are unmet.

An index-provided integrity value MUST NOT silently override an independently observed artifact integrity value. A mismatch MUST fail acquisition.

## Safe acquisition

Safe acquisition MUST NOT import executable capability code into the host process before the isolation boundary.

The reference implementation constructs an inert module-backed capability from package metadata and passes source provenance to an executor. Legacy trusted/in-process loading is a separate explicit path.

## Isolation

An executor is responsible for the actual code boundary. The reference implementation provides:

- `DockerExecutor`: read-only container execution with network disabled unless declared, dropped capabilities, non-root execution and resource limits;
- `NodePermissionExecutor`: child-process execution using Node's Permission Model;
- `AutoIsolatedExecutor`: Docker first, then a Node fallback when strict requirements can be met;
- `InProcessExecutor`: explicit trusted-code compatibility mode.

The specification does not claim that any reference executor is universally safe for hostile code. Hosts MUST select isolation appropriate to their environment and risk.

## Lockfiles

A Capability lockfile binds:

- index URL and document digest;
- exact package name/version and optional package integrity;
- exact capability ID/version, module path and optional module integrity.

Lockfiles are deployment/reproducibility records and do not themselves authorize execution.

## Trust assessment

Trust policy operates on observed provenance. The reference assessment can require package identity, module/package integrity, repository, commit, attestation metadata, verified registry signatures, verified provenance, allowlists and a minimum deterministic score.

A numeric score MUST NOT be treated as cryptographic proof.

## Evaluations

A runtime MAY execute evaluation cases through the normal capability path. The reference eval harness preserves schema validation, authorization, verification and receipts. Determinism evaluation compares output hashes across repeated executions.

## Composition

Composed capabilities MUST declare the union of effects required by their steps. Runtime pipelines MAY preserve per-step planning, authorization and receipts.

## OpenAPI interoperability

OpenAPI 3.1 operations MAY be imported as capabilities. The reference adapter synthesizes structured inputs from parameters/request bodies, reads JSON response schemas where available and declares `network.connect`. Runtime policy remains authoritative.

## MCP interoperability

Capabilities MAY be projected as MCP tools. Schemas become tool schemas; behavior/effects become annotations; capability identity/version remain metadata. MCP annotations are hints and do not replace runtime authorization.

## Compatibility

The 0.x specification is experimental. The reference implementation retains the 0.0.x flat `defineCapability()` shape and string package exports as compatibility paths, but safe ecosystem acquisition requires the newer inert descriptor convention.
