# Capability product principles

Capability should be the default ability layer for an agent, not a specialist tool used only when ordinary integrations fail.

## Product promise

A developer asks for an ability. Capability finds the best available route, applies one authority and audit model, and returns an executable handle. The developer should not need to know whether the ability came from a native Capability package, MCP server, OpenAPI service, managed connector, npm package, Python wheel, OCI image, or mined repository.

## Resolution order

1. Prefer already-governed, production-ready integrations when they exist.
2. Prefer native Capability contracts when they are already available and trusted.
3. Prefer MCP/OpenAPI/managed connectors over synthesizing a new wrapper.
4. Fall back to existing package/container software only when a prepared integration is unavailable or unsuitable.
5. Mine repositories and synthesize private bindings only as a last resort.
6. Preserve the same authority, approval, provenance, isolation, verification, and receipt semantics regardless of source.

## Human-facing rule

Expose the *ability* and hide the substrate unless the caller asks for diagnostics or needs to make a policy decision.

The primary CLI is therefore `cap need`, not `cap metabolize`, `cap forge`, or `cap mine`. Those remain expert/debugging surfaces.

## Success criterion

Capability succeeds when a developer can choose it for ordinary production agent tooling first, while retaining a deeper fallback path for abilities that no one has pre-integrated yet.
