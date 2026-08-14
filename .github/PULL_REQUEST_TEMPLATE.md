## What changed?

<!-- Describe the outcome this changes for Capability users or implementers. -->

## If this adds a capability or registry entry

- [ ] I ran `npm run readiness` (or equivalent checks).
- [ ] I ran `npm run novelty` against the live Capability network.
- [ ] This is not a renamed functional twin of an existing capability.
- [ ] The input/output contract is precise enough for machine inspection and composition.
- [ ] Every possible effect is explicitly declared; effect-free code uses `effects: []`.
- [ ] Idempotence and reversibility declarations match real behavior.
- [ ] The indexed package/version exists on npm, unless this PR is the reference package release candidate.
- [ ] The indexed inert manifest exactly matches the package metadata.
- [ ] Public source/provenance is available when practical.

## Verification

<!-- Include tests, reproduction commands, or registry validation output. -->

```text
npm test
npm pack --dry-run
```

## Why is this materially better?

<!-- For new abilities, explain the actual new outcome, safety property, composition model, or execution property. Do not rely on naming differences. -->
