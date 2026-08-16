# Universal software discovery and sidecar bridges

Capability does not require the world's software to be rewritten.

Version 0.6 separates two questions that are easy to accidentally collapse:

1. **Can I find software that might solve this problem?**
2. **Do I have a machine-readable, reviewable contract that makes one specific operation safe enough to acquire and execute?**

The first question can range across existing ecosystems. The second remains deliberately stricter.

## Search the software world

```bash
cap world "render html to video"
```

The result is split into:

- `native`: executable Capability entries from federated indexes;
- `external`: npm packages and GitHub repositories that may already contain the needed functionality;
- `errors`: source-specific discovery failures without discarding results from healthy sources.

External entries are **candidates**, not capabilities. Capability does not claim that an arbitrary repository is safe, executable, or correctly understood just because search found it.

The MCP bootstrap bridge exposes the same distinction through `capability_search_world`.

## Sidecar bridges

Existing software can participate without upstream changes. A sidecar bridge binds a stable external operation to:

- a Capability manifest;
- an exact upstream artifact/version;
- an invocation surface;
- a visible authority declaration;
- provenance metadata.

For an existing npm CLI:

```bash
cap npm-inspect some-existing-package
cap bridge npm some-existing-package ./some-existing-package-cap \
  --id media/render \
  --bin existing-command \
  --effect filesystem.read \
  --effect filesystem.write
```

Capability generates a thin wrapper project. The original package remains the implementation and remains owned/published by its upstream author.

### Opaque authority is visible

A generated bridge does **not** pretend to know every side effect of unfamiliar software. Until the bridge author explicitly marks the authority list complete, the generated manifest includes:

```text
custom:external.opaque-effects
```

That custom effect requires explicit approval under the default permissive policy. The bridge author can audit upstream behavior, declare the complete effect surface, and regenerate with `--effects-complete`.

This is intentional: adaptation should make uncertainty visible rather than laundering an old project into a new trust label.

## MCP import

Existing MCP servers can be converted to Capability contracts without modifying the server:

```bash
cap mcp-import node ./server.mjs --namespace my-server
```

Programmatically:

```ts
const { session, capabilities } = await connectStdioMcpCapabilities({
  command: "node",
  args: ["./server.mjs"],
  namespace: "my-server"
});
```

Imported MCP tools are conservative by default. Unless a host supplies a complete effect mapping, their manifests include `custom:mcp.opaque-effects`. A stdio import also declares `process.spawn` and `environment.read` because the bridge launches an external process.

## OpenAPI remains a first-class import path

`capabilitiesFromOpenApi()` already converts OpenAPI 3.1 operations into Capability contracts. The CLI now accepts local files or remote URLs:

```bash
cap openapi https://api.example.com/openapi.json example
```

## Growth model

Capability can now grow in two directions at once:

```text
NEW AGENT-NATIVE SOFTWARE
          |
          v
  native Capability
          |
          +------------------+
                             |
EXISTING SOFTWARE            v
 npm / GitHub / MCP / OpenAPI ---> common Capability contracts ---> agents
          |
          v
 sidecars / importers
```

The long-term objective is not to create a second island of software. It is to make useful software that already exists legible to agents while giving new agent-oriented software a richer native contract from the beginning.
