# Capability

**Executable abilities for agents, with inspection and authorization before execution.**

`@wheresmycoleslaw/capability` is an experimental standard and TypeScript runtime for packaging software as self-describing capabilities that agents can discover, inspect, plan, authorize, execute, verify, audit, compose, and optionally roll back.

```text
DISCOVER -> INSPECT -> PLAN -> AUTHORIZE -> EXECUTE -> VERIFY -> RECEIPT
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
  execute({ a, b }) {
    return { result: a + b };
  }
});
```

## Runtime

```ts
import { CapabilityRuntime, permissivePolicy } from "@wheresmycoleslaw/capability";
import add from "./add.js";

const runtime = new CapabilityRuntime({ policy: permissivePolicy }).register(add);
const plan = await runtime.plan("math/add", { a: 20, b: 22 });
const decision = runtime.authorize(plan);
const receipt = await runtime.execute(plan);
```

The default runtime denies declared effects unless a policy permits them. `permissivePolicy` allows declared effects but requires explicit approval for mutating/open-world effects.

## Effects

Built-in vocabulary:

```text
filesystem.read      filesystem.write
network.connect      process.spawn
environment.read     secrets.read
database.read        database.write
email.send           git.commit
git.push
```

Custom effects use `custom:<namespace>`.

## Discovery before acquisition

npm packages can expose inert capability manifests through a `capability` field in `package.json`. `CapabilityCatalog` indexes those manifests without importing executable modules.

```ts
const catalog = new CapabilityCatalog();
await catalog.indexPackage("./node_modules/@example/image-tools/package.json");
const [match] = catalog.discover("resize an image locally");
const capability = await catalog.acquire(match.manifest.id);
```

The intended acquisition path is:

```text
INDEX METADATA -> DISCOVER -> ACQUIRE -> PLAN -> AUTHORIZE -> EXECUTE -> VERIFY -> RECEIPT
```

Package acquisition checks that the loaded module's manifest matches the inert manifest advertised by package metadata and can optionally verify SHA-256 integrity.

## Discovery

`CapabilityRegistry` provides lexical discovery. `EmbeddingRanker` allows vendor-neutral semantic ranking with a caller-supplied embedding function.

## MCP

`createMcpAdapter(runtime)` projects registered capabilities into MCP-style tool descriptors and routes tool calls through the Capability runtime so policy remains the authorization layer.

```ts
import { createMcpAdapter } from "@wheresmycoleslaw/capability/mcp";
const mcp = createMcpAdapter(runtime);
const tools = mcp.listTools();
```

## Composition

`composeCapabilities()` creates a composite capability and unions the effects required by its steps. `runPipeline()` keeps steps independently planned, authorized, executed, and receipted.

## Receipts, verification, rollback

Execution produces a receipt containing capability identity/version, effects, timing, input/output hashes, status, and observed provenance. A capability may provide `verify()` and `rollback()` hooks. Rollback is available only when the manifest explicitly declares `behavior.reversible: true`.

## Provenance

Package acquisition attaches observed package/source metadata to capabilities. Receipts preserve that provenance. Provenance records observations; they are not a substitute for signature or attestation verification.

## Isolation

`NodePermissionExecutor` and `runInNodePermissionSandbox()` provide an optional out-of-process Node Permission Model execution boundary for module-backed capabilities. This is defense-in-depth, not a hostile-code sandbox. See [SECURITY.md](./SECURITY.md).

## Specification

See [SPEC.md](./SPEC.md), [ARCHITECTURE.md](./ARCHITECTURE.md), and [capability-manifest.schema.json](./capability-manifest.schema.json).

## License

MIT
