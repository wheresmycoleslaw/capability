# Ability provider priority

Capability is intentionally integration-first and synthesis-last.

Recommended priorities:

| Priority | Provider class | Typical examples |
|---|---|---|
| 10 | Managed/approved connector | Gmail, Slack, Stripe, GitHub |
| 20 | Native Capability package | known Capability ecosystem ability |
| 30 | MCP/OpenAPI | prepared remote tool or service operation |
| 100+ | Custom application provider | organization-specific catalogs |
| fallback | Software world | npm, PyPI, OCI, repository mining, composition |

The software-world fallback is built into `need()` and is not registered as an ordinary provider. This ensures a prepared provider always has the chance to satisfy the intent before Capability synthesizes or mines software.

Applications remain free to use a different ordering by assigning provider priorities explicitly.
