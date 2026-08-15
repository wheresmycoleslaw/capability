# Capability Discovery

Capability separates two discovery problems:

1. **Protocol bootstrap** — how a human or agent learns that Capability exists.
2. **Ability discovery** — how a Capability-aware client finds an executable ability without installing arbitrary code first.

Version 0.5 closes the bootstrap gap with multiple independent entry points instead of depending on one registry, one website, or one agent ecosystem.

## Human bootstrap

The canonical human entry points are:

- the npm package `@wheresmycoleslaw/capability`;
- the GitHub repository `wheresmycoleslaw/capability`;
- the public Capability page hosted by SITHIX;
- search-engine-readable pages, `robots.txt`, sitemap metadata, and `llms.txt`.

A developer can immediately create an ability with:

```bash
npx @wheresmycoleslaw/capability create my-capability --id my-domain/my-ability
```

## Agent bootstrap through MCP

Capability ships a bootstrap MCP server through the same package:

```bash
npx -y @wheresmycoleslaw/capability mcp-serve
```

An MCP host can launch that command and receive a small stable tool surface:

- `capability_search`
- `capability_inspect`
- `capability_execute`
- `capability_probe_site`
- `capability_doctor`

The bridge deliberately does **not** project the entire network into an agent prompt. It gives the model a discovery primitive. The model searches only when it needs an ability, inspects the contract, and executes through Capability's normal verification and isolation path.

This makes Capability a bootstrap layer for MCP rather than a competing tool transport.

## Website bootstrap

A site can advertise Capability support at either of these locations:

```text
/.well-known/capabilities
/.well-known/capabilities.json
```

The first existing valid document wins.

Example:

```json
{
  "capabilityDiscoveryVersion": "0.1",
  "indexes": [
    "https://raw.githubusercontent.com/wheresmycoleslaw/capability/main/registry/index.json"
  ],
  "package": {
    "name": "@wheresmycoleslaw/capability",
    "version": "0.5.0"
  },
  "mcp": [
    {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@wheresmycoleslaw/capability", "mcp-serve"]
    }
  ],
  "documentation": "https://sithix.com/capability",
  "repository": "https://github.com/wheresmycoleslaw/capability"
}
```

A client may probe a domain before knowing its APIs or package layout, validate the discovery document, then fetch the advertised inert indexes.

The website is **not** treated as a trust root. Package artifact, signature/provenance, manifest binding, authorization, and isolation checks still happen later.

## Discovery graph

```text
search engine / npm / GitHub / documentation
                    |
                    v
               Capability
                    |
        +-----------+-----------+
        |                       |
        v                       v
  MCP bootstrap           /.well-known/
        |                  capabilities
        +-----------+-----------+
                    |
                    v
             federated indexes
                    |
                    v
      discover inert capability contracts
                    |
                    v
       verify -> acquire -> authorize
                    |
                    v
            isolated execution
                    |
                    v
                  receipt
```

## Why the MCP bridge stays small

A large network may eventually contain millions of capabilities. Exposing every capability as a static MCP tool would make discovery scale with prompt size and would re-create the pre-wiring problem under another name.

The bootstrap bridge therefore exposes **search and acquisition as tools**, not every ability in the network. This is intentional.

## Why `.well-known`

A predictable origin-relative location gives agents and ordinary software a zero-configuration probe before they know a site's framework, package manager, language, or API documentation format. Capability treats the document as a locator, not an authority.

## Federation

The discovered site document points to one or more Capability indexes. Those indexes may in turn federate to other independent indexes. No central registry is required for protocol operation.

## Adoption test

Bootstrap discovery is working when all three paths work independently:

1. a developer finds the project through normal web/npm/GitHub discovery;
2. an MCP host can install one bootstrap bridge and search the network on demand;
3. an agent can probe an arbitrary participating domain and find its advertised Capability indexes without hardcoded integration knowledge.
