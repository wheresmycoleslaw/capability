# Changelog

## 0.8.1

- fix intent-first Forge execution from automatically created temp directories: Docker runs forged code as a non-root UID, while `mkdtemp` creates 0700 roots; Forge now makes only the generated root traversable (0755) before first-run isolation
- prefer npm-backed GitHub repositories when `cap solve` spends bounded Forge attempts, matching the current executable binder boundary instead of wasting attempts on repositories with no installable npm artifact
- increase the default Forge attempt budget from 4 to 6 while preserving every failed attempt and reason in the result
- update generated Capability/Forge projects to depend on the fixed 0.8.1 runtime

## 0.8.0

- add Capability Forge: mined GitHub functions and CLIs can become private executable sidecars without upstream adoption
- bind npm-backed source evidence to the exact published artifact and re-mine npm `gitHead` before execution when available
- add `cap forge github` for source → artifact → generated contract → Docker execution → receipt
- add intent-first `cap solve`, which searches native abilities and the existing software world, then attempts runtime forging when needed
- add MCP `capability_forge_repository` and `capability_solve` so an agent can expand its toolset during the same session
- preserve unknown authority through `custom:external.opaque-effects`; forged first runs require explicit approval and Docker and never silently fall back in-process
- add content-addressed evidence hashes and forge descriptors linking candidate evidence, exact source commit, exact npm package/version/integrity, generated binding, and authority status

## 0.7.0

- mine arbitrary GitHub repositories at exact commits into evidence-backed, non-executable ability candidates
- correlate public source declarations with manifests, docs, tests, examples, routes, confidence and source coverage
- infer visible authority signals while explicitly preserving incomplete/unknown effects
- add `cap mine github` and MCP `capability_mine_repository`
- expose `@wheresmycoleslaw/capability/repository-mine` and repository-mining documentation

## 0.6.1

- fix generated npm CLI sidecars under strict TypeScript by explicitly typing bridge execute/verify hooks
- add release-gate coverage that compiles and runs a sidecar around the unchanged TypeScript `tsc` package before publishing

## 0.6.0

- software-world discovery through `cap world`, keeping executable Capability entries separate from external npm/GitHub candidates
- resilient external catalog search that can return healthy-source results even when another catalog is unavailable or rate-limited
- exact npm package inspection through `cap npm-inspect`, including published bins, repository, integrity, and native Capability declaration detection
- first sidecar bridge format and JSON Schema for binding existing software to Capability without rewriting the upstream project
- `cap bridge npm` scaffolding for exact-version existing npm CLI tools
- explicit `custom:external.opaque-effects` authority marker until a bridge author audits and declares the complete upstream effect surface
- MCP-to-Capability import for existing MCP tools with conservative effect mapping
- stdio MCP client/importer through `cap mcp-import`, allowing an unchanged MCP server to become Capability-compatible at runtime
- `capability_search_world` MCP bootstrap primitive for finding useful software outside the native Capability registry
- remote URL support for `cap openapi`, extending the existing OpenAPI 3.1 importer beyond local files
- universal interoperability guide describing native software, external candidates, sidecars, MCP imports, and trust boundaries
- post-release smoke coverage for real npm-world discovery, npm inspection, MCP import, and the existing isolated execution paths

## 0.5.0

- bootstrap discovery layer so developers and agents can find Capability before already knowing about it
- `/.well-known/capabilities` website discovery convention and JSON Schema
- `cap probe <site>` for zero-configuration domain discovery
- executable `cap mcp-serve` bootstrap bridge exposing network search, inspection, verified isolated execution, website probing, and readiness checks
- MCP compatibility across modern `server/discover` negotiation and legacy `initialize` clients
- machine-readable `llms.txt` discovery guide
- public SITHIX landing page and search-engine bootstrap surface
- live registry moved to the 0.5.0 package artifact after release

## 0.4.0

- one-command project scaffolding through `cap create`
- publish-readiness scoring through `cap readiness`
- live network novelty analysis through `cap novelty`
- registry record generation through `cap registry-entry`
- generated projects include strict TypeScript, runtime/package manifest drift tests, CI, tokenless trusted-publisher workflow, packaging checks, and federation instructions
- new `capability/novelty-radar` primitive for detecting likely functional twins before they pollute the ecosystem
- new `capability/authority-envelope` primitive for exposing excess authority and aggregate plan risk before execution
- new `capability/contract-router` primitive for deterministic capability chaining by contract rather than model guesswork
- new `capability/receipt-drift` primitive for detecting behavioral, authority, verification and supply-chain drift across executions
- new `capability/failure-frontier` primitive for locating points of no return, compensation coverage, approval checkpoints and retry-safe prefixes in agent plans
- new `capability/substitution-certificate` primitive for certifying a replacement only when contract, authority, behavior guarantees and supplied trust posture do not regress
- new `capability/contract-evolution` primitive for classifying capability upgrades using contract semantics, effects and behavioral guarantees rather than package shape alone
- new `capability/dominance-resolver` primitive for preserving a Pareto frontier of interchangeable abilities across authority risk, trust, determinism and reversibility
- new public `innovation`, `evolution` and `scaffold` API surfaces
- automated registry contribution validation against exact third-party npm metadata and package integrity
- registry duplicate/twin gating and contributor pull-request template
- public adoption guide, contributor guide and static project landing page
- post-release smoke workflow expanded to scaffold a clean-room adopter project and execute new agent-native capabilities through Node and Docker isolation
- adoption doctrine requiring materially differentiated contributions rather than renamed wrappers

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
