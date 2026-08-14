# Architecture

Capability separates **what software says it can do** from **whether a host permits it to do that** and **where its code runs**.

## Layers

```text
                    federated static indexes
                              |
                    inert package metadata
                              |
                     exact-version resolver
                              |
              npm signature/provenance verifier
                              |
                    inert acquisition object
                              |
                +-------------+-------------+
                |                           |
             policy                      planner
                |                           |
                +-------------+-------------+
                              |
                       execution plan
                              |
                         authorization
                              |
                +-------------+-------------+
                |                           |
          Docker executor            Node executor
                |                           |
                +-------------+-------------+
                              |
                         verification
                              |
                           receipt
```

## Contract layer

`CapabilityManifest` is inert data: identity, semantic version, schemas, effects, behavior and tags. Inspection operates on this layer and must not execute capability code.

npm packages expose full inert manifests through `package.json.capability`. Safe acquisition refuses string-only exports because there is no contract to verify before code loading.

## Discovery layer

`PublicCapabilityIndex` searches static manifests without installation. `fetchCapabilityNetwork()` recursively follows bounded `federates` links and merges exact package versions. Discovery therefore scales independently from model context and independently from executable loading.

`DiscoveryRanker` keeps semantic ranking pluggable. The default index remains deterministic lexical search.

## Acquisition layer

`VerifiedNpmPackageInstaller` resolves and installs an exact npm version with lifecycle scripts disabled. It verifies registry signatures and available provenance attestations with npm, records package integrity and source metadata, then `acquireIndexedCapability(..., { loadCode: false })` constructs an inert module-backed capability.

The selected index manifest is compared against the package's inert manifest. Executable module code is not imported into the host process on the safe path.

`capability.lock.json` pins the index digest, exact package/version, capability ID/version, module path and available integrity values.

## Policy layer

A plan binds capability ID/version, input hash, requested effects, summary, plan data and a fingerprint. The runtime rejects plan or input drift before execution.

Policies decide allow/deny/approval independently from capability implementation. Declaring an effect never grants it.

## Execution layer

`CapabilityExecutor` owns the lifecycle boundary: execute and, where available, plan/verify/rollback.

### Docker

`DockerExecutor` is the stronger reference boundary. It runs the installed package root read-only, defaults network to none, drops Linux capabilities, sets no-new-privileges, uses a non-root user and applies resource limits. Network is enabled only when `network.connect` is part of the authorized plan. Writable mounts require `filesystem.write`.

### Node Permission Model

`NodePermissionExecutor` runs lifecycle hooks out-of-process under Node's Permission Model. Package code is loaded only in the child. Node 25+ can enforce network denial/allowance. Earlier Node releases are not used as the strict no-network fallback when network isolation is required.

### Auto selection

`AutoIsolatedExecutor` prefers Docker. If Docker is unavailable, it uses the Node boundary with strict network isolation requirements. `InProcessExecutor` remains available only as an explicit trusted-code escape hatch.

## Verification and receipts

Input and output schemas are validated by the runtime. Optional verification hooks run through the same executor boundary for inert module-backed capabilities. Every execution attempt produces a receipt containing identity, effects, timing, input/output hashes, status, errors, verification and observed provenance.

Rollback requires a successful receipt, a reversible manifest, host authorization and a rollback implementation. Module-backed rollback also executes through the isolation boundary.

## Protocol edges

MCP and OpenAPI are adapters, not the core object model:

- MCP projects capabilities outward as tools.
- OpenAPI projects HTTP operations inward as capabilities.

Both converge on the same manifest, policy, executor and receipt model.

## Trust model

Trust and isolation are orthogonal. Registry data can help locate software but does not authenticate it. npm verification establishes properties of an acquired artifact, while the executor constrains runtime behavior. A trustworthy artifact can still have bugs; an isolated artifact can still produce bad output. Hosts should combine provenance, allowlists, policy, isolation, validation and receipts according to risk.
