# Capability Standard

**Specification version:** 0.1  
**Package implementation:** 0.1.x  
**Status:** Experimental

## 1. Purpose

Capability defines a portable unit of executable functionality that an agent or runtime can discover, inspect, authorize, execute, verify, record, and where supported, roll back.

```text
DISCOVER -> INSPECT -> PLAN -> AUTHORIZE -> EXECUTE -> VERIFY -> RECEIPT
```

The standard separates **what a capability says it can do** from **the runtime policy that decides whether it may do it**.

## 2. Manifest

A compliant capability MUST expose a manifest containing `specVersion`, stable namespaced `id`, semantic `version`, `name`, and `description`. It SHOULD expose JSON Schema for `input` and `output`, declared `effects`, behavioral properties, and discovery tags.

The normative machine-readable schema is `capability-manifest.schema.json`.

## 3. Stable identity

`id` MUST contain at least one namespace separator (`/`) and match:

```text
^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)+$
```

Identity and version are separate. A plan binds both so an implementation cannot silently change between planning and execution.

## 4. Effects

Built-in effects in 0.1 are:

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

Extensions MUST use `custom:<namespace>`. A capability MUST NOT request an effect during planning that it did not declare in its manifest. Declarations are claims; runtimes SHOULD pair them with an execution isolation mechanism when stronger enforcement is required.

## 5. Behavior

A manifest MAY declare `deterministic`, `idempotent`, and `reversible`. `reversible: true` SHOULD only be used when a rollback implementation is supplied.

## 6. Inspection

Inspection MUST NOT execute capability code and MUST NOT expose the executable function in the inspection result.

## 7. Planning

A plan contains a unique plan ID, capability ID/version, structured input and input hash, requested effects, human-readable summary, creation time, optional capability-defined plan data, and an integrity fingerprint.

An implementation MAY narrow its declared effects for a specific invocation. It MUST NOT add undeclared effects. A runtime MUST reject a plan if its fingerprint or input hash changes after planning.

## 8. Authorization

Authorization is runtime policy, not capability policy. The reference runtime supports allow, deny, and explicit-approval effect patterns. Deny rules take precedence. Wildcards such as `*` and `filesystem.*` are supported. The reference runtime denies effectful capabilities by default.

## 9. Execution and validation

Before execution, input SHOULD be validated against the declared input schema. After execution, output SHOULD be validated against the output schema. The reference implementation validates a common JSON Schema subset and allows applications to layer a complete JSON Schema 2020-12 engine when needed.

## 10. Verification

A capability MAY expose a verification hook. A failed verification makes the execution fail and is recorded.

## 11. Receipts

Every reference-runtime execution attempt produces a receipt containing receipt and plan IDs, capability identity/version, status, timing, effects, input hash, output hash on success, optional input/output values, verification result, serialized errors, and provenance when known. Receipt storage is pluggable.

## 12. Rollback

Rollback requires a successful prior receipt, `behavior.reversible === true`, a rollback hook, and authorization for the relevant effects. Rollback operates from the original receipt and records `rolled_back` or `rollback_failed`.

## 13. Discovery

The reference registry supports lexical discovery over IDs, names, descriptions, and tags. Runtimes MAY provide semantic ranking. `DiscoveryRanker` and `EmbeddingRanker` allow any embedding backend without coupling the standard to a model vendor.

## 14. Composition

Capabilities MAY be composed into pipelines. A composed capability MUST declare the union of effects required by its steps. The reference runtime also supports policy-preserving runtime pipelines where each step receives its own plan, authorization decision, and receipt.

## 15. Package discovery convention

An npm package MAY advertise exported capabilities using a `capability` field in `package.json`:

```json
{
  "capability": {
    "specVersion": "0.1",
    "exports": {
      "image/resize": {
        "module": "./dist/resize.js",
        "manifest": {
          "specVersion": "0.1",
          "id": "image/resize",
          "version": "1.0.0",
          "name": "Resize image",
          "description": "Resize an image locally.",
          "effects": ["filesystem.read", "filesystem.write"]
        }
      }
    }
  }
}
```

Every export path MUST be package-relative and every acquired capability's manifest ID MUST equal its declared export ID. Canonical descriptors SHOULD embed the complete inert manifest. The reference acquisition layer compares package metadata to the manifest exported by the acquired module and rejects drift. A string-only module path remains a legacy package declaration but cannot be inspected before import.

This convention enables **index metadata -> discover -> acquire exact module -> authorize -> execute**.

## 16. Provenance

Provenance is runtime-observed metadata, not a self-trust claim. The reference implementation can attach source, npm package/version, repository, commit, integrity, and attestation references to a capability and copy them into receipts. Package-manager signatures and external attestations remain separate verification concerns.

## 17. Isolation

The reference package provides an optional Node Permission Model executor for module-backed capabilities. It runs code in a separate Node process, removes inherited environment variables unless explicitly supplied, and maps declared filesystem/process effects onto Node permission flags.

This is defense-in-depth, not a malicious-code security boundary. Higher-assurance runtimes SHOULD use an OS sandbox, container, VM, WASM runtime, remote worker, or equivalent boundary.

## 18. MCP interoperability

A capability can be projected as an MCP tool descriptor: manifest ID becomes an MCP-safe tool name, schemas become MCP schemas, behavior/effects become annotations, and capability identity/version are preserved in metadata. MCP annotations remain hints; Capability authorization and isolation remain runtime responsibilities.

## 19. Compatibility

The 0.x series is experimental. Minor versions may change APIs or schema details. The reference implementation preserves the 0.0.x flat `defineCapability()` shape as a compatibility path, assigning legacy definitions a local ID and version when omitted.
