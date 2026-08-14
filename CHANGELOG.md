# Changelog

## 0.4.0

- one-command project scaffolding through `cap create`
- publish-readiness scoring through `cap readiness`
- live network novelty analysis through `cap novelty`
- registry record generation through `cap registry-entry`
- generated projects include strict TypeScript, runtime/package manifest drift tests, CI, tokenless trusted-publisher workflow, packaging checks, and federation instructions
- new `capability/novelty-radar` invention for detecting functional twins before they pollute the ecosystem
- new `capability/authority-envelope` invention for exposing excess authority and plan risk before execution
- new `capability/contract-router` invention for deterministic capability chaining by contract rather than model guesswork
- new `capability/receipt-drift` invention for detecting behavioral and supply-chain drift across executions
- new `capability/failure-frontier` invention for locating points of no return, compensation coverage, and retry-safe prefixes in agent plans
- new public `innovation` and `scaffold` API surfaces
- adoption doctrine requiring materially differentiated contributions rather than duplicate wrappers

## 0.3.0

- live default public registry seeded with effect-free capabilities
- bounded federation across independently hosted capability indexes
- `CapabilityHub` for discover → resolve → verify → acquire → isolated execute
- safe inert acquisition path that does not import capability modules into the host process
- exact npm artifact verification through registry signatures and provenance attestations
- strict npm trust policy with package integrity and verified provenance requirements
- Docker isolation executor with read-only filesystem, default-deny network, non-root execution, dropped capabilities and resource limits
- Node Permission Model lifecycle executor for plan/execute/verify/rollback
- auto-isolation executor selecting Docker first and strict Node fallback second
- isolated lifecycle hooks so planning, verification and rollback do not escape the execution boundary
- capability lockfiles pinning index digest, package identity and capability identity
- public CLI commands: `find`, `info`, `install`, `exec`, `doctor`
- built-in `text/normalize`, `text/slugify`, `data/sha256`, and `json/get` capabilities
- public registry generation/check tooling to prevent package/index drift
- package-root escape checks for module descriptors
- package and module manifest binding across index, package metadata and installed artifact

## 0.2.0

- public, mergeable capability index format and JSON Schema
- remote index fetching and pre-acquisition discovery
- exact-version npm installer with lifecycle scripts disabled
- installer-pluggable indexed acquisition path
- deterministic provenance trust assessment and trust policy gates
- automated eval harness and deterministic replay checks
- OpenAPI 3.1 operation-to-capability adapter
- `cap` / `capability` command-line interface
- clean builds to prevent stale artifacts from entering npm tarballs
- repository provenance captured from package metadata
- stable hashing fixed for shared object references while retaining cycle detection

## 0.1.0

- formal 0.1 manifest and JSON Schema
- stable capability identity/version binding
- runtime input/output validation
- effect allow/deny/approval policy
- tamper-evident plans
- execution receipts and pluggable receipt storage
- verification and rollback hooks
- lexical and pluggable embedding discovery
- capability composition and policy-preserving runtime pipelines
- npm package capability declaration and acquisition
- provenance attachment to execution receipts
- MCP tool projection and call adapter
- optional Node Permission Model isolation helper
- CLI for validate/inspect/plan/run/find/MCP/package operations
- backwards-compatible 0.0.x definition path

## 0.0.1

- initial `defineCapability`, `inspectCapability`, and `runCapability` primitives
- experimental specification skeleton
