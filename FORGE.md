# Capability Forge

Capability Forge closes the gap between **understanding useful software** and **turning it into a live agent ability**.

Repository mining in Capability 0.7 deliberately stopped at non-executable inference. Forge 0.8 adds a stronger boundary that can bind selected evidence to an exact published artifact, generate a private Capability sidecar, force opaque authority to remain visible, and execute the result in Docker with a receipt.

## The loop

```text
intent
  ↓
search native + external software
  ↓
mine an ordinary GitHub repository
  ↓
select a useful public function / CLI
  ↓
bind source evidence to exact npm artifact
  ↓
verify npm gitHead ↔ mined GitHub commit when available
  ↓
generate an inert Capability contract + sidecar
  ↓
require explicit approval for unknown authority
  ↓
install with lifecycle scripts disabled
  ↓
execute first run in Docker
  ↓
receipt
```

The upstream project does not need to know Capability exists and is not modified.

## Forge a repository ability

```bash
cap forge github owner/repo --query "desired outcome"
```

Select a specific symbol when a repository exposes multiple useful operations:

```bash
cap forge github owner/repo --symbol normalizeText
```

Execute the generated ability after reviewing its descriptor:

```bash
cap forge github owner/repo \
  --symbol normalizeText \
  --execute '{"args":["  hello   world  "]}' \
  --approve
```

First execution is intentionally Docker-only. Forge will not silently fall back to in-process execution for inferred external software.

## Intent-first solving

```bash
cap solve "convert this value into camel case" \
  --external \
  --input '{"args":["hello world"]}' \
  --approve
```

`cap solve` searches the normal Capability network first unless `--external` is used. If no native ability is selected, it searches existing software, mines promising GitHub repositories, and attempts to forge a defensible binding from the best candidates.

The result records failed forge attempts rather than hiding them. A candidate that cannot be tied to an installable artifact, a callable export, or an exact source revision is skipped instead of being promoted to trusted code.

## Source-to-artifact binding

For npm-backed repositories, Forge prefers an explicit chain:

```text
GitHub repository
      ↓
mined candidate + evidence
      ↓
npm package identity/version
      ↓
npm gitHead
      ↓
re-mine that exact gitHead
      ↓
forged sidecar
```

When npm exposes `gitHead`, Forge re-runs repository mining at that commit. This prevents a current README or branch from being used as evidence for an older published package.

If the npm artifact does not expose `gitHead`, Forge refuses the stronger path by default. `allowUnverifiedSource` / `--allow-unverified-source` is an explicit downgrade, not an implicit fallback.

## Authority membrane

A successful source binding is **not** proof of a complete side-effect model.

Every forged operation starts with:

```text
authority.complete = false
custom:external.opaque-effects
```

Static effect evidence from repository mining is carried forward, but absence of evidence is never converted into permission. First execution therefore requires explicit approval and Docker isolation.

## What Forge can automatically bind today

- npm CLI entry points discovered in an ordinary GitHub repository;
- JavaScript/TypeScript public functions that are callable from the published npm package root.

The repository miner can understand more languages and surfaces than Forge can execute automatically. Those remain useful evidence for future binders instead of being faked into executability.

## The point

Capability is no longer limited to a world where developers pre-author tools for agents.

A sufficiently compatible open-source project can move through:

```text
unknown repository
→ discovered software
→ mined ability
→ exact artifact
→ generated contract
→ isolated execution
→ reusable receipt-backed ability
```

That is the beginning of software becoming an **on-demand ability substrate** rather than a pile of integrations someone had to wire together ahead of time.
