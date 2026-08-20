# Capability

**One ability layer for AI agents. Ask for an outcome; Capability finds the best available way to do it, governs execution, and keeps a receipt.**

`@wheresmycoleslaw/capability` is an open-source TypeScript runtime and protocol for agent abilities. It is designed to be useful for ordinary production integrations first, while retaining a fallback path into the wider software world when no prepared tool exists.

The caller should not need a second architecture when its normal tool catalog runs out.

## Ambient mode: connect once, then get out of the way

Capability can run as an agent-internal missing-ability layer. The end user asks for an outcome; the host agent uses its normal tools first and calls Capability only when a required ability is missing. Successful discovery and low-risk execution stay in the background. Consequential authority is surfaced for explicit approval.

```ts
import { createAmbientCapabilityLayer } from "@wheresmycoleslaw/capability";

const capability = createAmbientCapabilityLayer({ providers });
const fallback = await capability.resolveMissing("the ability the agent is missing", { input });

// fallback.visibility === "silent" for normal resolution/execution
// fallback.state === "approval_required" when the user must authorize an effect
```

This is deliberately a fallback primitive, not a command the end user should have to learn. See [`AMBIENT.md`](./AMBIENT.md).

```text
                         NEED
                          |
              "send an email"
              "create an invoice"
              "resize this image"
              "validate this weird file"
                          |
                          v
                 PREPARED PROVIDERS
          connectors / MCP / OpenAPI / native
                          |
                    match found?
                    /          \
                  yes           no
                   |             |
                   |             v
                   |      SOFTWARE-WORLD FALLBACK
                   |      npm / PyPI / OCI / GitHub
                   |      composition / capability gap
                   |             |
                   +-------> AUTHORIZE
                                |
                             EXECUTE
                                |
                              VERIFY
                                |
                              RECEIPT
```

## Why Capability

Most agent stacks work well while every useful operation has already been exposed as a tool. Capability keeps that easy path, but it also has somewhere to go when the prepared ecosystem has no answer.

- **Use what already exists first.** Prepared connectors, MCP tools, OpenAPI operations and application-specific catalogs are preferred before software synthesis.
- **One application contract.** The caller asks for an ability instead of choosing an integration mechanism up front.
- **One governance model.** Prepared and acquired abilities can share authorization, execution and receipt semantics.
- **Fallback without redesign.** When ordinary integrations stop being enough, Capability can search and bind existing packages, containers and repositories instead of forcing the application to grow a second tool system.
- **No forced ecosystem migration.** Existing MCP servers, OpenAPI services, npm packages, Python wheels and OCI images do not need to be rewritten as Capability projects first.

Capability does **not** claim that arbitrary software is safe, that every repository is executable, or that hashes prove benign behavior. The trust and isolation boundaries are explicit.

## Install

```bash
npm install @wheresmycoleslaw/capability
```

Node 20+ is supported. Docker is recommended for execution of external software.

## The default API: `need()`

```ts
import {
  AbilityProviderRegistry,
  defineAbilityProvider,
  need
} from "@wheresmycoleslaw/capability";

const providers = new AbilityProviderRegistry().register(
  defineAbilityProvider({
    id: "company/connectors",
    kind: "connector",
    priority: 10,
    description: "Company-approved integrations",

    async discover({ intent }) {
      return lookupCompanyTools(intent);
    },

    async execute(candidate, context) {
      return {
        output: await callCompanyTool(candidate.id, context.input),
        receipt: {
          provider: "company/connectors",
          ability: candidate.id
        }
      };
    }
  })
);

const result = await need("send an email", {
  providers,
  execute: true,
  input: {
    to: "person@example.com",
    subject: "Hello",
    body: "Sent through one ability layer."
  },
  approved: true
});

console.log(result);
```

`need()` checks prepared providers in explicit priority order. If none can satisfy the intent, Capability falls back to its existing acquisition engine.

That fallback can resolve a native Capability, discover ordinary software, bind a defensible operation, execute it when authorized, or leave an unresolved need as a machine-readable capability gap.

See [`docs/NEED.md`](./docs/NEED.md).

## Reuse MCP and OpenAPI providers

Capability is not trying to replace successful integration ecosystems. It can put them behind the same ability interface.

Create `capability.providers.json`:

```json
{
  "providers": [
    {
      "type": "mcp",
      "id": "company-tools",
      "command": "node",
      "args": ["./mcp-server.mjs"],
      "priority": 20
    },
    {
      "type": "openapi",
      "id": "billing",
      "source": "./billing.openapi.json",
      "headers": {
        "authorization": "Bearer ${BILLING_TOKEN}"
      },
      "priority": 30
    }
  ]
}
```

Environment placeholders are expanded when the provider configuration is loaded.

```ts
import { loadProviderConfig, need } from "@wheresmycoleslaw/capability";

const loaded = await loadProviderConfig("capability.providers.json");
try {
  const result = await need("create an invoice", {
    providers: loaded.registry,
    execute: true,
    input: { body: { customer: "cus_123" } },
    approved: true
  });
  console.log(result);
} finally {
  await loaded.close();
}
```

Applications can also register any managed connector SDK or private tool catalog by implementing the small `AbilityProvider` interface. Capability core does not need a project-specific integration for each vendor.

## The default MCP surface: `capability_need`

Capability can itself run as an MCP server:

```bash
npx -y @wheresmycoleslaw/capability mcp-serve
```

With prepared providers:

```bash
CAPABILITY_PROVIDERS=./capability.providers.json \
  npx -y @wheresmycoleslaw/capability mcp-serve
```

The first/default MCP tool is `capability_need`.

An MCP host can ask for an outcome without deciding whether it should come from a prepared integration, the Capability network, npm, Python, OCI or repository mining. The older expert tools remain exposed for explicit inspection and control.

## What happens when prepared tools are not enough?

Capability retains the deeper acquisition system developed in 1.0.

### Native Capability packages

Capability packages expose inert manifests before executable code is loaded. The runtime can discover an ability, resolve an exact package/version, verify available registry and provenance evidence, authorize effects, run through an isolation executor, and record a receipt.

### npm / Node

Capability can search npm/GitHub from an outcome, inspect package and source evidence, bind root-callable JavaScript/TypeScript exports or npm CLIs to an exact package/source revision, generate a private sidecar, and execute first-run inferred software in Docker after approval.

```bash
cap solve "turn separated text into camel case" \
  --input '{"args":["hello capability world"]}' \
  --approve
```

### PyPI / Python

Capability can mine an explicitly selected universal wheel without importing it into the host, verify the exact wheel bytes against PyPI SHA-256, bind functions or console scripts, and execute from those exact bytes in a network-denied Docker environment.

```bash
cap pypi-forge inflection \
  --query "camelize text" \
  --symbol camelize \
  --execute '{"args":["hello_world"]}' \
  --approve
```

### OCI / Docker

Mutable image tags are resolved to immutable `RepoDigest` identities before execution.

```bash
cap oci-inspect busybox:1.36
cap oci-run busybox:1.36 echo hello --approve
```

### MCP

Existing MCP servers can be imported conservatively without changing the upstream server. Missing effect evidence remains visible as opaque authority rather than being silently treated as safe.

```bash
cap mcp-import node ./server.mjs --namespace existing-server
```

### OpenAPI

OpenAPI 3.1 operations can become normal Capability contracts with network effects and runtime policy applied around them.

```bash
cap openapi ./openapi.json my-service
```

### Arbitrary GitHub repositories

Capability can inspect an ordinary repository at an exact commit and infer candidate functions, CLIs and HTTP operations from source, docs, tests and examples.

```bash
cap mine github owner/repo --query "render video"
```

Repository mining is **not universal execution**. A mined candidate remains non-executable until a real binder can turn the relevant software substrate into a defensible execution path.

### Composition

Schema-compatible abilities can be composed while preserving per-step authority and receipts.

```bash
cap compose-intent "normalize text then slugify text" \
  --input '{"text":"  Hello Capability World  "}'
```

### Explicit gaps

If Capability cannot satisfy an outcome defensibly, it does not invent success. It can preserve the unresolved need as a machine-readable specification.

```bash
cap gap "perform a missing operation" --out missing.json
cap build-gap missing.json ./missing-capability
```

## The advanced software-world entry point

`cap metabolize` remains available when a developer explicitly wants substrate-level control:

```bash
cap metabolize "camelize separated text" \
  --python inflection \
  --input '{"args":["hello_world"]}' \
  --approve
```

But metabolism is an implementation mechanism, not the primary product story. Normal callers should ask for an ability and let provider policy select the route.

## Core execution lifecycle

Regardless of where an ability comes from, Capability separates claims that are often blurred together:

```text
DISCOVER
   |
RESOLVE
   |
VERIFY / ACQUIRE
   |
INSPECT
   |
PLAN
   |
AUTHORIZE
   |
EXECUTE
   |
VERIFY
   |
RECEIPT
   |
ROLLBACK?  (only when supported)
```

A manifest describes what an ability claims. Runtime policy decides what it may do. Isolation determines how strongly execution is contained. Provenance records what was observed. None of those claims substitute for the others.

## Effects and approval

Built-in effects include:

```text
filesystem.read      filesystem.write
network.connect      process.spawn
environment.read     secrets.read
database.read        database.write
email.send           git.commit
git.push
```

Custom effects use `custom:<namespace>`.

The default runtime denies declared effects unless the host supplies policy. `permissivePolicy` still requires explicit approval for mutating/open-world effects.

External software with incomplete authority remains marked as incomplete. Missing evidence is not interpreted as absence of side effects.

## Isolation

`AutoIsolatedExecutor` prefers Docker and can fall back to the Node Permission Model where the requested boundary is available.

Docker execution uses a read-only filesystem, non-root execution, dropped Linux capabilities, `no-new-privileges`, resource limits and no network by default.

This is defense in depth, not a proof that hostile code is safe. High-risk environments should use a dedicated container/VM/remote-worker policy appropriate to their threat model.

## Exact artifacts and receipts

Capability binds execution to concrete identities where the substrate supports them:

- exact npm package/version/integrity and source revision when available;
- exact PyPI wheel SHA-256 bytes;
- immutable OCI `RepoDigest`;
- exact repository commit for source mining;
- versioned Capability manifests and package identities.

Execution receipts preserve the ability identity, effects, timing, input/output hashes and observed provenance. Metabolic binder receipts additionally preserve substrate, exact artifact, evidence, authority completeness and isolation information.

A hash proves **which bytes were selected**, not whether those bytes are benign.

## Capability 1.x protocol

Capability 1.0 established the stable public compatibility line. The load-bearing 1.x contracts include the manifest/runtime model, stable binder envelope, authority/artifact invariants, MCP bootstrap compatibility and documented command semantics.

New providers, binders, effects and discovery systems can be added compatibly during 1.x.

```bash
npm run conformance
```

See:

- [`SPEC.md`](./SPEC.md)
- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`STABILITY.md`](./STABILITY.md)
- [`CONFORMANCE.md`](./CONFORMANCE.md)
- [`SECURITY.md`](./SECURITY.md)
- [`METABOLISM.md`](./METABOLISM.md)
- [`BINDERS.md`](./BINDERS.md)
- [`docs/NEED.md`](./docs/NEED.md)

## Existing expert CLI

The existing CLI remains available for direct control and debugging:

```text
cap find / info / install / exec / doctor
cap world / mine / forge / solve / metabolize
cap pypi-inspect / pypi-mine / pypi-forge
cap oci-inspect / oci-run
cap mcp-import / openapi / probe / mcp-serve
cap compose-intent / gap / build-gap
cap create / readiness / novelty / registry-entry
```

These commands expose the machinery. `need()` and `capability_need` expose the product-level abstraction.

## Status

Capability is a young project. The architecture and 1.x protocol are real; broad production adoption and large-scale comparative benchmarks are not yet established. Treat that distinction seriously when deciding where to deploy it.

## License

MIT
