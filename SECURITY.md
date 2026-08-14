# Security Model

Capability treats manifests, indexes, packages and capability code as separate trust boundaries.

## Core invariants

1. **Discovery is inert.** Searching public indexes does not install or import capability code.
2. **Safe acquisition is inert.** The reference ecosystem path reads package metadata and module bytes but does not import the executable module into the host process.
3. **Effects are declarations, not permission.** Runtime policy remains authoritative.
4. **Plans are bound before execution.** Input, capability version and requested effects are fingerprinted and checked for drift.
5. **Artifact trust and runtime isolation are independent.** A verified package still executes inside the selected boundary.
6. **Receipts record what happened.** They do not prove semantic correctness by themselves.

## Public indexes

Public index documents are untrusted discovery metadata. Package names, versions, manifests, repository URLs, integrity strings and federation links are attacker-controlled inputs until independently verified.

Federation traversal is bounded by depth and maximum-index limits and de-duplicates visited URLs. A federation relationship does not transfer trust.

## npm acquisition

`NpmPackageInstaller` installs exact package versions with lifecycle scripts disabled. Disabling scripts reduces acquisition-time execution but does not make package files trustworthy.

`VerifiedNpmPackageInstaller` additionally runs npm registry signature/provenance verification and records observed package integrity, repository and commit metadata. `strictNpmTrustPolicy` requires exact package identity, package integrity, a verified registry signature and verified provenance before default ecosystem execution proceeds.

Verification is intentionally delegated to npm's package-verification machinery rather than reimplementing registry cryptography in this project.

## Host-import prevention

The safe acquisition path uses `inspectModuleBackedCapability()`. It binds the inert manifest from `package.json` to a module path, verifies the module bytes when an integrity value is present, and returns a non-executable host stub. The module is loaded later by an executor boundary.

`loadCapabilityFromPackage()` still exists for explicitly trusted/in-process applications. Do not use it for untrusted ecosystem acquisition.

## Package path containment

Module paths must begin with `./` and resolve inside the package root. Root escapes are rejected. The safe path requires full descriptor exports; a bare string module export cannot be inspected safely and is rejected.

## Policies

`CapabilityRuntime` defaults to `denyAllPolicy`. Capabilities declaring no effects can run; declared effects require a host policy.

`permissivePolicy` allows declared effects but requires explicit approval for mutating or open-world effects including filesystem writes, network access, process spawning, secrets, database writes, email and Git mutations.

A declared effect is never evidence that implementation behavior is limited to that effect. The executor must enforce the real boundary.

## Docker executor

`DockerExecutor` is the stronger reference execution boundary. It uses:

- a read-only container root filesystem;
- a read-only capability/install mount;
- network disabled by default;
- network enabled only for an authorized `network.connect` plan;
- non-root UID/GID;
- all Linux capabilities dropped;
- `no-new-privileges`;
- PID, memory and CPU limits;
- a small temporary filesystem;
- no inherited host environment by default;
- explicit mounts only.

Writable mounts require `filesystem.write` to be present in the plan. Containers still share the host kernel; high-assurance or hostile workloads may require stronger VM, microVM, WASM, remote-worker or OS-specific isolation.

## Node Permission Model executor

`NodePermissionExecutor` loads package code only in a child Node process under the Permission Model. It grants package read access and only effect-derived permissions configured by the host.

The Node Permission Model is defense-in-depth, not a security boundary for malicious code. Network isolation is only considered strict when the running Node version can enforce it; otherwise `AutoIsolatedExecutor` requires Docker or refuses the strict fallback for no-network capabilities.

Granting child-process access materially weakens the boundary. Hosts should avoid `process.spawn` for untrusted capabilities unless another outer isolation layer exists.

## Lifecycle hooks

For safely acquired module-backed capabilities, planning, execution, verification and rollback all run through the selected executor when those hooks exist. This avoids executing a supposedly harmless planning or verification hook in the host process before or after isolated execution.

## Provenance and trust scores

Provenance records observations. Fields such as registry-signature/provenance verification are set only after the configured verifier succeeds.

The numeric trust score is policy assistance, not cryptographic proof. Hosts should prefer explicit requirements (`requireRegistrySignature`, `requireVerifiedProvenance`, allowlists, integrity requirements) over a score alone.

## Receipts and sensitive data

Receipts may include input and output values. Applications handling secrets, regulated information or personal data SHOULD provide a custom receipt store that redacts, encrypts, limits retention or omits sensitive values.

## OpenAPI imports

OpenAPI documents are untrusted metadata and may point at arbitrary servers. Imported operations declare `network.connect`; hosts should additionally restrict destinations at the network/container/worker layer when origin control matters.

## In-process escape hatch

`InProcessExecutor` and CLI `--executor=in-process` intentionally import capability code into the host process. They are for code the host already trusts. The CLI makes this mode explicit and does not use it by default.

## Reporting vulnerabilities

Use a private GitHub security advisory for verification bypasses, registry poisoning, sandbox escapes, permission bypasses or other vulnerabilities. Do not publish working exploit details in a public issue before a fix is available.
