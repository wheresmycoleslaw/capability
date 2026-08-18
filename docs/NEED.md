# `cap need`: the default front door

`cap need` is the human-facing entry point for Capability.

The caller describes an outcome. Capability prefers the simplest already-governed provider first, then falls back to the wider software world only when necessary.

```text
intent
  |
  +--> prepared providers (connectors / MCP / OpenAPI / native)
  |       |
  |       +--> best ready candidate
  |
  +--> software-world fallback (npm / PyPI / OCI / repository / composition)
          |
          +--> exact binding + authority + isolation + receipt
          |
          +--> unresolved gap if nothing can satisfy the intent
```

## Provider API

Applications can register production integration catalogs without teaching Capability core about a vendor or individual service:

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
      return callCompanyTool(candidate.id, context.input);
    }
  })
);

const ability = await need("send an email", { providers });
```

Provider priority is explicit. Prepared providers should normally precede software synthesis because an audited integration with known credentials and semantics is cheaper and safer than generating a new binding.

## Principle

The provider is an implementation detail. The caller asks for an **ability**.

Expert commands such as `cap mcp-import`, `cap forge`, `cap pypi-forge`, `cap oci-run`, `cap mine`, and `cap metabolize` remain available for diagnostics, policy configuration, and direct substrate control.
