# Contributing to Capability

Capability is trying to become a useful interoperability standard, not a catalog of renamed wrappers. Contributions should make agents more capable, more predictable, more composable, or safer.

## Build a capability

```bash
npx @wheresmycoleslaw/capability create my-capability --id my-domain/my-ability
cd my-capability
npm install
npm test
npm run readiness
npm run novelty
```

Before proposing a package or federation entry:

1. **Prove a distinct outcome.** If the live network already has a functional twin, improve it instead of publishing a renamed copy.
2. **Declare the smallest authority surface.** Every possible effect must be explicit. Effect-free capabilities should declare `effects: []`.
3. **Make the contract precise.** Inputs and outputs should be specific enough for another agent to compose without guessing.
4. **Describe failure behavior.** Idempotence, reversibility, planning and verification should be implemented whenever the real operation supports them.
5. **Publish reproducibly.** Use an exact npm version, public source when possible, npm provenance/trusted publishing, tests and CI.

## Add a package to discovery

Generate the exact package record:

```bash
cap registry-entry package.json --out capability-registry-entry.json
```

Then either host an independent Capability index or submit the generated record to an existing index. The reference index lives at `registry/index.json`.

Registry pull requests are automatically checked for:

- valid index structure;
- duplicate capability identities;
- published npm package/version identity for third-party packages;
- exact equality between indexed inert manifests and npm package metadata;
- package integrity availability;
- likely functional twins in the existing registry.

A novelty result is not a marketing score. Do not rename fields or rewrite prose merely to increase it. The relevant question is whether the capability creates a materially different useful ability or improves an existing one in a way that matters.

## Host a federated index

Any HTTPS host can serve a valid `capability-index.schema.json` document. Add other index URLs to its `federates` array. A client follows federation links only for discovery; it still verifies the selected executable package separately.

See [REGISTRY.md](./REGISTRY.md) and [ADOPTION.md](./ADOPTION.md).

## Pull requests

Run before submitting:

```bash
npm test
npm pack --dry-run
```

Changes to the reference registry must also pass the Registry Contribution workflow. Security-sensitive issues involving verification bypasses, registry poisoning, or isolation escapes should be reported privately through GitHub Security Advisories rather than demonstrated in a public issue.
