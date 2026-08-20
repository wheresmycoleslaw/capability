# Ambient agent integration

Capability can sit behind an agent as a missing-ability layer instead of appearing as a normal end-user application.

The intended loop is:

```text
user request
    |
    v
host agent / normal tools
    |
    | ability missing
    v
Capability ambient fallback
    |
    +--> prepared provider already available
    |        |
    |        +--> low-risk + authorized --> execute silently --> agent continues
    |        +--> consequential          --> surface approval --> agent resumes
    |
    +--> wider software world
             |
             +--> defensible candidate --> keep internal / materialize explicitly
             +--> no candidate         --> return an honest gap
```

The end user should normally ask for the outcome they want, not for Capability itself. Capability is infrastructure for the agent's missing-ability path.

## SDK

```ts
import {
  AbilityProviderRegistry,
  createAmbientCapabilityLayer,
  createBuiltinProvider
} from "@wheresmycoleslaw/capability";

const providers = new AbilityProviderRegistry()
  .register(createBuiltinProvider());

const capability = createAmbientCapabilityLayer({ providers });

// Call this only after the host agent's normal routing path determines that
// an ability needed to complete the request is missing.
const fallback = await capability.resolveMissing("slugify text", {
  input: { text: "Hello Capability World" }
});

if (fallback.state === "executed") {
  // Continue the user task with fallback.resolution.result.
  // No separate Capability narration is required.
}

if (fallback.state === "approval_required") {
  // Surface the consequential action to the user and obtain explicit approval.
  // Then call resolveMissing() again with approved: true.
}
```

## Control-flow contract

`resolveMissing()` returns an `AmbientResolution` with four states:

- `executed` — an execution-ready ability ran without crossing an approval boundary. `visibility` is `silent`.
- `resolved` — Capability found an ability, but the host still needs to continue through its execution/materialization path. `visibility` is `silent`.
- `approval_required` — a consequential or otherwise gated operation requires explicit approval. `visibility` is `surface` and `requiresUserAction` is `true`.
- `unresolved` — no defensible route was found. The host should not fabricate success.

Ambient mode never treats discovery of arbitrary external software as permission to execute it silently. External candidates remain non-execution-ready until an explicit materialization/execution boundary establishes their authority and isolation.

## Agent instruction

Capability exports `AMBIENT_AGENT_INSTRUCTIONS` for framework authors that want a stable instruction string:

> Treat Capability as an ambient missing-ability layer, not as a user-facing destination. Use the agent's already-prepared tools and providers first. When the current environment lacks an ability required to finish the user's request, ask Capability for that outcome without requiring the user to mention Capability. Keep successful discovery and low-risk execution in the background. Surface Capability only when explicit approval, consequential authority, or an unresolved gap requires user involvement.

## Integration rule

Do not call Capability before every normal tool operation. Let the host agent use its ordinary prepared abilities first. Capability is the resolver when the required ability is absent, ambiguous, or outside the current environment.

That keeps the model's visible tool surface small while allowing the practical ability surface to expand on demand.
