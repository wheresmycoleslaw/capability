# Capability

**Executable abilities for agents, with inspection and authorization before execution.**

`@wheresmycoleslaw/capability` is an experimental standard and TypeScript runtime for packaging software as self-describing capabilities that agents can discover, inspect, plan, authorize, execute, verify, audit, compose, and roll back.

```text
DISCOVER -> INSPECT -> PLAN -> AUTHORIZE -> EXECUTE -> VERIFY -> RECEIPT
                                                        |
                                                        +-> ROLLBACK
```

## Install

```bash
npm install @wheresmycoleslaw/capability
```

Node 20+ is supported.

## Define

```ts
import { defineCapability } from "@wheresmycoleslaw/capability";

export default defineCapability({
  manifest: {
    specVersion: "0.1",
    id: "math/add",
    version: "1.0.0",
    name: "Add",
    description: "Add two numbers.",
    input: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"]
    },
    output: {
      type: "object",
      properties: { result: { type: "number" } },
      required: ["result"]
    },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    tags: ["math"]
  },
  execute({ a, b }) { return { result: a + b }; }
});
```

## Runtime

```ts
const runtime = new CapabilityRuntime({ policy: permissivePolicy }).register(add);
const plan = await runtime.plan("math/add", { a: 20, b: 22 });
const decision = runtime.authorize(plan);
const receipt = await runtime.execute(plan);
```

The default runtime denies declared effects unless a policy permits them. Mutating/open-world effects require explicit approval under `permissivePolicy`.

## Effects

```text
filesystem.read      filesystem.write
network.connect      process.spawn
environment.read     secrets.read
database.read        database.write
email.send           git.commit
git.push
```

Custom effects use `custom:<namespace>`.

## Discovery and acquisition

`CapabilityRegistry` provides local lexical discovery. `EmbeddingRanker` makes semantic ranking pluggable without coupling core to a model vendor.

Packages can advertise inert capability manifests through `package.json.capability`. `CapabilityCatalog` can index those manifests before importing executable modules.

```text
INDEX METADATA -> DISCOVER -> ACQUIRE -> PLAN -> AUTHORIZE -> EXECUTE -> VERIFY -> RECEIPT
```

`PublicCapabilityIndex` adds a static, mergeable JSON index format for discovery across packages. `fetchCapabilityIndex()` retrieves an index, and `acquireIndexedCapability()` installs an exact package version through a pluggable installer, verifies package metadata, attaches provenance, and applies trust policy.

## Trust and provenance

`assessCapabilityTrust()` produces a deterministic policy score from observed package identity, integrity, repository, commit, and attestation metadata. Trust scoring is policy input, not cryptographic proof.

## Automated evaluations

`runCapabilityEvals()` executes repeatable cases through the real runtime, preserving policy, validation, verification, and receipts. `evaluateDeterminism()` replays the same input and compares output hashes.

## OpenAPI

`capabilitiesFromOpenApi()` projects OpenAPI 3.1 operations into capabilities. Imported operations declare `network.connect` and use synthesized input/output schemas.

## MCP

`createMcpAdapter(runtime)` projects registered capabilities into MCP-style tool descriptors and routes calls back through the Capability runtime.

## Composition

`composeCapabilities()` creates code-level composite capabilities. `runPipeline()` keeps each step independently planned, authorized, executed, and receipted.

## Receipts and rollback

Every execution attempt produces a receipt with capability identity/version, status, timing, effects, input/output hashes, verification result, errors, and observed provenance. Receipt storage is pluggable. Rollback requires both `behavior.reversible: true` and a rollback hook.

## Isolation

`NodePermissionExecutor` and `runInNodePermissionSandbox()` provide an optional out-of-process Node Permission Model boundary. This is defense-in-depth, not a hostile-code security boundary. See [SECURITY.md](./SECURITY.md).

## CLI

The package ships `cap` and `capability` binaries:

```text
cap validate <manifest.json>
cap package <package.json>
cap acquire <package.json> <capability-id>
cap plan <package.json> <capability-id> <json-input>
cap run <package.json> <capability-id> <json-input> [--approve]
cap find <query> <package.json...>
cap eval <package.json> <capability-id> <cases.json> [--approve]
cap trust <package.json> <capability-id>
cap index <output.json> <package.json...>
cap openapi <openapi.json> [namespace]
cap mcp-tools <package.json...>
```

## Documents

- [Specification](./SPEC.md)
- [Architecture](./ARCHITECTURE.md)
- [Security model](./SECURITY.md)
- [Manifest JSON Schema](./capability-manifest.schema.json)
- [Public index JSON Schema](./capability-index.schema.json)

## License

MIT
