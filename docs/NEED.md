# Ability-first Capability

The primary application API is `need()`. The primary MCP tool is `capability_need`.

A caller describes the outcome it needs. Capability prefers the simplest prepared provider first and falls back to the wider software world only when necessary.

```text
intent
  |
  +--> prepared providers
  |     connectors / MCP / OpenAPI / application catalogs
  |       |
  |       +--> best ready candidate
  |
  +--> Capability network / existing software fallback
        native / npm / PyPI / OCI / repository / composition
          |
          +--> exact binding + authority + isolation + receipt
          |
          +--> unresolved gap if nothing can satisfy the intent
```

The point is that the developer asks for an **ability**, not a substrate.

## Application API

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
    description: "Company-approved SaaS integrations",
    async discover({ intent }) {
      return lookupCompanyTools(intent);
    },
    async execute(candidate, context) {
      return {
        output: await callCompanyTool(candidate.id, context.input),
        receipt: { provider: "company/connectors", ability: candidate.id }
      };
    }
  })
);

const resolved = await need("send an email", { providers });
const executed = await need("send an email", {
  providers,
  execute: true,
  input: { to: "person@example.com", subject: "Hello" },
  approved: true
});
```

Prepared providers are always considered before software synthesis. That is deliberate: a known integration with established credentials and semantics is normally cheaper and safer than generating a new binding.

## Reuse MCP and OpenAPI instead of replacing them

Capability can load prepared MCP servers and OpenAPI services from a provider configuration file.

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

Load it in an application:

```ts
import { loadProviderConfig, need } from "@wheresmycoleslaw/capability";

const providers = await loadProviderConfig("capability.providers.json");
try {
  const result = await need("create an invoice", {
    providers: providers.registry,
    execute: true,
    input: { body: { customer: "cus_123" } },
    approved: true
  });
  console.log(result);
} finally {
  await providers.close();
}
```

Or expose the same provider set through Capability's MCP bootstrap:

```bash
CAPABILITY_PROVIDERS=./capability.providers.json \
  npx -y @wheresmycoleslaw/capability mcp-serve
```

The MCP host sees `capability_need` first. Mining, Forge, metabolism and composition remain available as advanced controls when prepared integrations are insufficient.

## Resolution rule

1. Prepared application/managed providers by explicit priority.
2. If none can satisfy the intent, Capability's existing software-world engine runs.
3. The fallback prefers native Capability abilities before acquiring or synthesizing external software.
4. If no defensible route exists, the need remains an explicit machine-readable gap.

This makes Capability useful for ordinary agent tooling without giving up its deeper ability-acquisition path.
