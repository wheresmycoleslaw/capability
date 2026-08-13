# Capability Standard

**Version:** 0.0.1  
**Status:** Experimental

## Definition

A capability is a self-describing executable unit of functionality intended to be discovered, inspected, authorized, executed, and verified by software agents.

Version 0.0.1 defines the capability data model and the minimum inspection and execution API. Discovery transports, authorization policy, and isolation mechanisms are intentionally left open for later versions.

## Lifecycle

```text
DISCOVER -> INSPECT -> AUTHORIZE -> EXECUTE -> VERIFY
```

A capability MUST be inspectable before it is executed.

## Required fields

A capability MUST declare:

- `name`
- `description`
- `execute`

## Optional metadata

A capability SHOULD declare enough metadata for a runtime to reason about its inputs, outputs, effects, and behavioral properties:

- `input`
- `output`
- `effects`
- `behavior`

## Effects

Version 0.0.1 defines declarations for:

- filesystem read
- filesystem write
- network access
- shell execution
- environment access

Effect declarations are metadata in version 0.0.1. They are not an enforcement boundary.

## Behavior

A capability may declare whether execution is:

- deterministic
- idempotent
- reversible

## Inspection

Inspection MUST NOT execute the capability. The inspection result MUST NOT expose the capability's executable function.

## Execution

A runtime executes a capability with structured input and returns structured output or a rejected promise/error.

## Future versions

Future versions are expected to define:

- permission enforcement
- plan/apply semantics
- execution receipts
- rollback
- provenance
- sandboxing
- semantic discovery
- capability composition
- MCP interoperability

## Compatibility

Until version 1.0.0, this specification may change incompatibly between minor versions.
