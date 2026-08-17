# Capability Metabolism

Capability treats existing software as an ability substrate rather than requiring every useful operation to be authored for the protocol first.

The goal is **metabolic coverage**: increase the fraction of useful software that an agent can discover, understand, bind to an exact artifact, authorize, isolate, execute, verify, and receipt without upstream modification.

The architecture deliberately separates four stages:

```text
OUTCOME
  ↓
DISCOVER software
  ↓
MINE artifact/repository evidence
  ↓
BIND a selected operation
  ↓
AUTHORIZE + ISOLATE + EXECUTE
```

A binder is generalized by execution substrate rather than by individual project. One binder should unlock a class of software.

Current substrate families:

- Capability-native packages
- npm / Node package exports and CLIs
- PyPI / Python package functions and console scripts
- OCI container images
- MCP servers
- OpenAPI services
- arbitrary repository evidence mining

Capability also supports contract-level composition and machine-readable capability gaps. If no single ability satisfies an outcome, the planner can search for schema-compatible compositions. If neither discovery nor composition resolves the outcome, Capability can emit a gap specification describing the missing contract, authority ceiling, and verification requirements instead of silently failing.

## Trust boundary

Metabolism is not trust.

External artifacts remain source- or artifact-bound, authority-incomplete unless proven otherwise, and isolated on first execution. Missing effect evidence never means an effect is absent. Generated bindings are private by default and preserve opaque authority markers until reviewed.

## Coverage

`cap coverage` reports the supported substrate families and the strongest automatic boundary currently available for each. Coverage is intentionally reported as concrete substrate support, not a fake percentage of "all software".

## Intent-first use

```bash
cap metabolize "desired outcome" --input '{"args":[]}' --approve
```

The engine can route through native abilities, npm/GitHub Forge, PyPI/Python, OCI images, MCP, OpenAPI, composition, or a capability-gap result depending on what is actually defensible.
