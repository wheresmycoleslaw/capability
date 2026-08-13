# Architecture

Capability is intentionally split into layers so no single agent framework, model vendor, package registry, or transport owns the abstraction.

```text
                  +----------------------+
                  | npm / local packages |
                  +----------+-----------+
                             |
                    package declaration
                             |
                  +----------v-----------+
                  |     acquisition      |
                  +----------+-----------+
                             |
            +----------------v----------------+
            | CapabilityRegistry / discovery |
            +----------------+----------------+
                             |
        DISCOVER -> INSPECT -> PLAN -> AUTHORIZE
                             |
                  +----------v-----------+
                  |  CapabilityRuntime   |
                  +-----+------------+---+
                        |            |
                    execute       receipts
                        |            |
                     verify      provenance
                        |
                     rollback
```

## Core objects

`CapabilityManifest` is inert metadata. It is safe to inspect without invoking `execute`.

`Capability` binds a manifest to `execute` and optional `plan`, `verify`, and `rollback` hooks.

`CapabilityRegistry` owns discovery and identity resolution.

`CapabilityRuntime` owns planning, authorization, schema validation, execution, verification, receipts, and rollback.

`ReceiptStore` is an interface. The built-in implementation is in-memory so databases and append-only audit systems can replace it.

`DiscoveryRanker` is an interface. The built-in registry has lexical search and `EmbeddingRanker` makes semantic search pluggable.

`CapabilityCatalog` indexes inert package manifests before executable modules are acquired.

## Transport adapters

MCP is an adapter, not the core object model. That keeps Capability usable by MCP clients, direct TypeScript applications, job runners, and future protocols.

## Execution boundaries

The in-process runtime enforces policy before invoking code but cannot stop intentionally dishonest code from performing undeclared side effects. Strong isolation is delegated to execution boundaries. `runInNodePermissionSandbox` is the first reference boundary and can be replaced by containers, VMs, WASM, or remote workers.

## Why package metadata matters

A package's `capability.exports` declaration is deliberately separate from executable modules. A registry can index package metadata, capability IDs, and versions before deciding whether code should ever be acquired or loaded.
