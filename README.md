# Capability

**Executable abilities for agents: discover first, inspect and authorize before execution, verify what was acquired, and keep a receipt.**

`@wheresmycoleslaw/capability` is an experimental TypeScript standard, runtime, CLI, developer kit, and federated public index for self-describing executable capabilities.

```text
PUBLIC INDEX / FEDERATION
          |
       DISCOVER
          |
        RESOLVE
          |
   VERIFY + ACQUIRE
          |
        INSPECT
          |
         PLAN
          |
      AUTHORIZE
          |
  ISOLATED EXECUTE
          |
        VERIFY
          |
        RECEIPT
          |
      ROLLBACK?
```

## Install

```bash
npm install @wheresmycoleslaw/capability
```

Node 20+ is supported. For default isolated ecosystem execution, use Docker or Node 25+.

## Create a capability

The fastest adoption path is one command:

```bash
npx @wheresmycoleslaw/capability create my-capability --id my-domain/my-ability
cd my-capability
npm install
npm test
npm run readiness
npm run novelty
```

The generated project includes a strict TypeScript implementation, inert package manifest, drift test, packaging checks, CI, tokenless trusted-publishing workflow, registry-entry generation, and live-network novelty analysis.

See [ADOPTION.md](./ADOPTION.md) for the full zero-to-federation path.

## Try the live ecosystem

```bash
cap doctor
cap find "normalize text"
cap info text/normalize
cap install text/normalize
cap exec text/normalize '{"text":"  Hello   WORLD  ","case":"lower"}' --executor=node
```

The default public index is hosted from this repository at `registry/index.json`. Index documents may federate to other independently hosted indexes.

## What is a capability?

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
  execute({ a, b }: { a: number; b: number }) {
    return { result: a + b };
  }
});
```

## Package convention

A package advertises inert manifests in `package.json` before any executable module is imported:

```json
{
  "capability": {
    "specVersion": "0.1",
    "exports": {
      "math/add": {
        "module": "./dist/add.js",
        "manifest": {
          "specVersion": "0.1",
          "id": "math/add",
          "version": "1.0.0",
          "name": "Add",
          "description": "Add two numbers.",
          "effects": []
        }
      }
    }
  }
}
```

Safe ecosystem acquisition requires the descriptor form above; a bare module-path export cannot be safely inspected before code loading.

## Runtime

```ts
import { CapabilityRuntime, permissivePolicy } from "@wheresmycoleslaw/capability";

const runtime = new CapabilityRuntime({ policy: permissivePolicy }).register(capability);
const plan = await runtime.plan("math/add", { a: 20, b: 22 });
const decision = runtime.authorize(plan);
const receipt = await runtime.execute(plan);
```

The default runtime denies declared effects unless the host supplies a policy. `permissivePolicy` still requires explicit approval for mutating/open-world effects.

## Effects

```text
filesystem.read      filesystem.write
network.connect      process.spawn
environment.read     secrets.read
database.read        database.write
email.send           git.commit
git.push
```

Extensions use `custom:<namespace>`.

## Safe acquisition

`CapabilityHub` connects discovery to exact-version acquisition:

```ts
import { CapabilityHub } from "@wheresmycoleslaw/capability/ecosystem";

const hub = new CapabilityHub();
const matches = await hub.discover("slugify text");
const execution = await hub.run("text/slugify", { text: "Hello World" });
```

The default hub:

1. fetches and merges the federated public index;
2. selects an exact package and capability version;
3. installs with npm lifecycle scripts disabled;
4. verifies registry signatures and available npm provenance attestations;
5. compares installed package metadata with the inert index manifest;
6. does **not** import capability code into the host process;
7. executes lifecycle hooks through an isolation executor;
8. records observed provenance in the receipt.

`cap install` also writes `capability.lock.json`, pinning index digest, exact package/version, and capability identity.

## Isolation

`AutoIsolatedExecutor` prefers Docker and falls back to the Node Permission Model where it can provide the requested boundary.

Docker execution uses a read-only filesystem, non-root user, dropped Linux capabilities, no-new-privileges, resource limits, and no network by default. `network.connect` is required before the Docker executor enables network access.

The Node Permission Model is defense-in-depth, not a hostile-code sandbox. Node 25+ can deny network by default and selectively enable it. For hostile or high-risk code, use a dedicated container/VM/remote worker policy appropriate to your environment.

## Trust

`strictNpmTrustPolicy` requires exact package identity, package integrity, a verified npm registry signature, and a verified provenance attestation. Trust metadata and execution isolation are separate controls; neither replaces the other.

## Discovery

`PublicCapabilityIndex` performs inert lexical discovery. `EmbeddingRanker` provides a vendor-neutral hook for semantic ranking. `fetchCapabilityNetwork()` recursively follows bounded federation links and merges indexes without installing packages.

## Built-in seed capabilities

The live registry contains effect-free capabilities that prove the complete acquisition path and several new agent-native inventions:

```text
text/normalize
text/slugify
data/sha256
json/get

capability/novelty-radar
capability/authority-envelope
capability/contract-router
capability/receipt-drift
capability/failure-frontier
```

The last five are deliberately not generic wrappers:

- **Novelty Radar** detects functional twins before they enter the ecosystem.
- **Authority Envelope** exposes excess permission and plan risk before execution.
- **Contract Router** determines safe capability-to-capability chaining from contracts instead of model guesswork.
- **Receipt Drift** detects behavioral, authority, and supply-chain drift between executions.
- **Failure Frontier** finds the first irreversible mutation, compensation coverage, approval checkpoints, and retry-safe prefix of an agent plan.

## Developer commands

```text
cap create <directory> [--name PACKAGE] [--id CAPABILITY-ID] [--description TEXT] [--repo URL] [--force]
cap readiness [package.json]
cap novelty <capability-id|manifest.json> [--package package.json] [--index URL]
cap registry-entry [package.json] [--out PATH]
```

`cap novelty` is intentionally part of the normal publishing path. Capability does not need an ecosystem full of renamed copies of the same function; contributors are encouraged to improve an existing ability or occupy genuine whitespace.

## Ecosystem commands

```text
cap doctor [--index URL]
cap find <query> [--index URL] [--limit N]
cap info <id-or-query> [--index URL]
cap install <id-or-query> [--index URL] [--lock PATH]
cap exec <id-or-query> <json-input> [--approve] [--index URL] [--executor auto|docker|node|in-process]
```

## Interoperability

- `createMcpAdapter()` projects registered capabilities as MCP tools while preserving runtime authorization.
- `capabilitiesFromOpenApi()` imports OpenAPI 3.1 operations as capabilities declaring `network.connect`.
- `composeCapabilities()` and `runPipeline()` support composition while preserving effects and receipts.

## Registry participation

See [REGISTRY.md](./REGISTRY.md) to publish capabilities or federate an independent index.

## Documents

- [Adoption guide](./ADOPTION.md)
- [Specification](./SPEC.md)
- [Architecture](./ARCHITECTURE.md)
- [Security model](./SECURITY.md)
- [Registry and federation](./REGISTRY.md)
- [Manifest JSON Schema](./capability-manifest.schema.json)
- [Public index JSON Schema](./capability-index.schema.json)

## License

MIT
