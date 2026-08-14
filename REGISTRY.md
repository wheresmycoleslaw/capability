# Public Registry and Federation

The Capability ecosystem is deliberately registry-light. Discovery uses static JSON indexes; execution still comes from exact package artifacts and is independently verified by the client.

## Canonical root

The reference root index is:

```text
registry/index.json
```

The CLI resolves it from the raw `main` branch by default. A client may replace or supplement that root with `--index`.

## Publish a capability package

A package intended for safe ecosystem acquisition MUST:

1. publish an exact package version;
2. include `package.json.capability.specVersion`;
3. use descriptor exports with a complete inert manifest, not only a module path;
4. keep each module path package-relative;
5. ensure the loaded capability manifest exactly matches its inert package metadata;
6. declare every effect the capability may require;
7. preferably publish from a public source repository with npm trusted publishing/provenance.

Example:

```json
{
  "name": "@example/image-capabilities",
  "version": "1.0.0",
  "capability": {
    "specVersion": "0.1",
    "exports": {
      "image/resize": {
        "module": "./dist/resize.js",
        "manifest": {
          "specVersion": "0.1",
          "id": "image/resize",
          "version": "1.0.0",
          "name": "Resize Image",
          "description": "Resize an image.",
          "effects": ["filesystem.read", "filesystem.write"]
        }
      }
    }
  }
}
```

## Host an independent index

Any HTTPS host may publish a Capability index matching `capability-index.schema.json`:

```json
{
  "indexVersion": "0.1",
  "generatedAt": "2026-08-14T00:00:00.000Z",
  "packages": [
    {
      "name": "@example/image-capabilities",
      "version": "1.0.0",
      "source": "npm",
      "repository": "https://github.com/example/image-capabilities",
      "capabilities": []
    }
  ],
  "federates": []
}
```

Index metadata is untrusted discovery data. It does not grant execution permission and does not establish package authenticity.

## Federate

An index may list other index URLs in `federates`. `fetchCapabilityNetwork()` follows those links with bounded depth and a maximum-index limit, de-duplicates URLs, validates each document, then merges exact package versions.

To join the reference federation, submit a pull request adding your HTTPS index URL to `registry/index.json.federates`. Do not add executable code to this repository merely to join the federation.

A federation PR should include:

- the index URL;
- the source repository that owns the index;
- at least one valid package descriptor;
- evidence that the package is publicly installable at the exact indexed version;
- npm provenance/trusted-publisher setup when strict clients are expected to acquire it.

## Client verification

The reference strict acquisition path does not trust the index by itself. It independently:

1. resolves an exact package/version;
2. reads registry metadata;
3. installs with lifecycle scripts disabled;
4. runs npm signature/provenance verification;
5. records the package integrity and source metadata;
6. compares the installed inert manifest against the selected index entry;
7. avoids importing executable code into the host process;
8. executes through the selected isolation boundary.

Hosts may use stricter policy, private registries, private indexes, organization allowlists, or additional signature systems.

## Versioning

Capability IDs identify an ability family. Capability `manifest.version` versions the ability contract. npm package versions version the package artifact. Both are pinned during acquisition and may advance independently.

Clients resolving an exact capability ID choose the newest semantic capability version available in the loaded network, then the newest containing package version. Production deployments should generate and commit a `capability.lock.json` when reproducibility matters.

## Root registry maintenance

The reference package keeps its own seed capabilities synchronized with the root index:

```bash
npm run registry
npm run registry:check
```

CI runs `registry:check`; package metadata and its root registry record cannot drift unnoticed.

## Security reports

Registry poisoning, verification bypasses, isolation escapes, or malicious federation behavior should be reported through a private GitHub security advisory rather than a public issue before a fix exists.
