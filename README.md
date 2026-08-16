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

## Bootstrap discovery

Capability can now be found and entered from outside its own ecosystem instead of assuming the client already knows the protocol.

**From an MCP host:**

```bash
npx -y @wheresmycoleslaw/capability mcp-serve
```

The bridge gives the agent a small stable surface for native search, software-world search, inspection, execution, website probing, and diagnostics—without dumping the entire Capability network into the model context.

**From a website:**

Participating sites advertise one or more indexes at `/.well-known/capabilities` (or the `.json` fallback). Probe one with:

```bash
cap probe https://example.com
```

See [DISCOVERY.md](./DISCOVERY.md) for the bootstrap architecture and site descriptor format.

## Search beyond Capability

Capability no longer requires useful software to have been authored inside the Capability ecosystem before it can be found.

```bash
cap world "render html to video"
```

`cap world` returns two deliberately separate classes of results:

- **native** — executable Capability contracts that can proceed through normal resolution, verification, authorization, isolation, and receipts;
- **external** — npm packages and GitHub repositories that may already solve the problem but are only candidates until an adapter/importer supplies a defensible machine-readable contract.

Existing software does not need to be rewritten. An existing npm CLI can be wrapped in a thin sidecar:

```bash
cap npm-inspect some-package
cap bridge npm some-package ./some-package-cap --id vendor/ability --bin some-command
```

An unchanged MCP server can be imported into Capability contracts at runtime:

```bash
cap mcp-import node ./server.mjs --namespace existing-server
```

Unknown external side effects remain explicit through opaque-authority markers until a bridge author audits them. Capability does not turn search results into trusted code by declaration. See [UNIVERSAL.md](./UNIVERSAL.md).

## Mine an arbitrary GitHub repository

Capability can move beyond repository-level search and inspect the contents of an ordinary project that has never adopted Capability:

```bash
cap mine github owner/repo
cap mine github owner/repo --query "render video"
```

The miner resolves an exact commit, reads bounded repository evidence, identifies public/exported functions, CLI surfaces and HTTP operations, correlates docs/tests/examples, infers visible authority signals, and emits non-executable draft contracts with explicit confidence and coverage. It does **not** execute the repository and it never treats missing effect evidence as proof that an effect is absent.

This turns GitHub from a directory of projects into a latent ability corpus while preserving the line between **discovery** and **trust**. See [REPOSITORY_MINING.md](./REPOSITORY_MINING.md).

## Forge an ability from software that never adopted Capability

Capability 0.8 can cross the boundary that repository mining deliberately left closed. After finding a useful operation in an ordinary GitHub repository, Forge can bind that evidence to an exact published npm artifact, generate a private Capability sidecar, preserve unknown authority explicitly, and execute the first run in Docker with a receipt.

```bash
cap forge github sindresorhus/slugify --query "slugify text" --symbol slugify
cap forge github sindresorhus/slugify --symbol slugify --execute '{"args":["Hello Capability World"]}' --approve
```

Or start with nothing but an outcome:

```bash
cap solve "turn a string into camel case" --external --input '{"args":["hello capability world"]}' --approve
```

When npm publishes `gitHead`, Forge re-mines that exact commit before generating the executable binder. Source evidence therefore cannot silently drift away from the package version being executed. Every forged operation still carries `custom:external.opaque-effects`, requires approval, and uses Docker for first execution. See [FORGE.md](./FORGE.md).

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
cap find "failure frontier"
cap info capability/failure-frontier
cap install capability/failure-frontier
cap exec capability/failure-frontier '{"steps":[]}' --executor=node
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
const matches = await hub.discover("failure frontier");
const execution = await hub.run("capability/failure-frontier", { steps: [] });
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

The live registry contains effect-free seed utilities plus research-informed, agent-native primitives designed around problems created by dynamically acquired software itself:

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
capability/substitution-certificate
capability/contract-evolution
capability/dominance-resolver
```

The agent-native set is deliberately not a catalog of renamed utility wrappers:

- **Novelty Radar** compares a proposed ability with the reachable ecosystem and warns about functional twins before they become duplicate clutter.
- **Authority Envelope** exposes excess authority and the aggregate permission/risk surface of a plan before execution.
- **Contract Router** determines safe capability-to-capability chaining from machine-readable contracts instead of model guesswork.
- **Receipt Drift** detects behavioral, authority, verification, package-identity, and package-integrity drift between executions.
- **Failure Frontier** finds the first irreversible mutation, compensation coverage, approval checkpoints, and retry-safe prefix of a multi-step plan.
- **Safe Substitution Certificate** determines whether one capability can replace another without expanding authority, weakening behavior guarantees, lowering trust, or breaking its conservative contract, then emits a deterministic certificate.
- **Contract Evolution Gate** treats authority and behavioral guarantees as part of compatibility, allowing safer version decisions than data-shape-only package versioning.
- **Dominance Resolver** keeps the Pareto frontier of interchangeable capabilities instead of hiding safety/trust tradeoffs inside one opaque ranking score.

## Developer commands

```text
cap create <directory> [--name PACKAGE] [--id CAPABILITY-ID] [--description TEXT] [--repo URL] [--force]
cap readiness [package.json]
cap novelty <capability-id|manifest.json> [--package package.json] [--index URL]
cap registry-entry [package.json] [--out PATH]
```

`cap novelty` is intentionally part of the normal publishing path. Capability does not need an ecosystem full of renamed copies of the same function; contributors are encouraged to improve an existing ability or occupy genuine whitespace.

## Safe evolution

Capability can reason about whether an ability can safely evolve or be replaced without reducing the question to package version numbers.

```ts
import {
  certifyCapabilitySubstitution,
  assessCapabilityEvolution,
  resolveCapabilityDominance
} from "@wheresmycoleslaw/capability/evolution";
```

A substitution certificate is accepted only when the replacement preserves the conservative contract, adds no authority, does not weaken declared determinism/idempotence/reversibility, and does not regress the supplied trust posture. Authority reductions are represented explicitly rather than treated as ordinary metadata changes.

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

See [REGISTRY.md](./REGISTRY.md) to publish capabilities or federate an independent index. Registry pull requests are automatically checked for structural validity, exact published package metadata, duplicate identities, and likely functional twins.

## Documents

- [Adoption guide](./ADOPTION.md)
- [Universal software discovery and bridges](./UNIVERSAL.md)
- [Capability Forge: intent to exact artifact-bound ability](./FORGE.md)
- [Contributing](./CONTRIBUTING.md)
- [Specification](./SPEC.md)
- [Architecture](./ARCHITECTURE.md)
- [Security model](./SECURITY.md)
- [Registry and federation](./REGISTRY.md)
- [Manifest JSON Schema](./capability-manifest.schema.json)
- [Public index JSON Schema](./capability-index.schema.json)

## License

MIT
