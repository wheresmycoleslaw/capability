# Repository capability mining

Capability can inspect an ordinary GitHub repository that was never authored for Capability and produce **candidate executable abilities** from the evidence already present in the repository.

```bash
cap mine github owner/repo
cap mine github https://github.com/owner/repo --query "render video"
```

The miner reads repository metadata, the exact commit tree, package manifests, documentation, examples, tests, and supported source files. It looks for public/exported functions, library exports, CLI entry points, HTTP operations, and public methods across common languages. Each candidate includes source location, signature, corroborating evidence, inferred effects, confidence, coverage, and a non-executable draft Capability contract.

## The hard boundary

Mining is **discovery and comprehension, not trust**.

A repository candidate always has:

```json
{
  "executable": false,
  "authority": {
    "complete": false
  }
}
```

The miner is allowed to be aggressive about finding possible abilities. It is not allowed to silently promote an inference into a trusted fact. Missing effect evidence never means an effect is absent.

A candidate can become executable only after a stronger boundary binds it to a concrete operation and artifact, for example:

- a native Capability contract;
- an npm CLI/library sidecar;
- an MCP import;
- an OpenAPI import;
- a reviewed adapter with explicit authority.

## Evidence model

Candidate confidence is based on independent evidence rather than source-name guessing alone:

- **declaration** — exported/public source symbol;
- **manifest** — package or CLI metadata;
- **documentation** — README/docs reference the symbol;
- **test** — tests reference the symbol;
- **example** — examples demonstrate the symbol;
- **route** — a framework route declaration exposes an HTTP operation;
- **effect** — the inspected code region contains a known authority primitive.

The report keeps those facts individually inspectable so a future agent or reviewer can see *why* Capability inferred the ability.

## Authority inference

The miner searches the candidate's local source region for signals corresponding to Capability effects such as filesystem reads/writes, network access, process spawning, environment reads, database access, email delivery, and Git mutation.

Those effects are evidence-backed inferences only. Transitive dependencies, reflection, dynamic loading, generated code, FFI/native modules, plugins, runtime configuration, and data-dependent behavior can escape static analysis. Reports surface hazards when these patterns are detected.

## Coverage

Large repositories are bounded by `--max-files` and `--max-file-bytes`. The report states:

- eligible files;
- analyzed files;
- eligible/analyzed source counts;
- source coverage ratio;
- whether GitHub truncated the recursive tree;
- unsupported file extensions.

This prevents a partial scan from masquerading as whole-repository comprehension.

## Supported source surfaces

The initial miner recognizes useful public surfaces in JavaScript, TypeScript, Python, Go, Rust, Java, Kotlin, C#, Ruby, PHP, and Swift, plus npm CLI manifests and common Express/FastAPI-style HTTP routes. Other repository files can still contribute documentation, manifest, MCP, OpenAPI, and hazard evidence even when their language is not yet parsed into individual symbols.

## Programmatic API

```ts
import { mineGitHubRepository } from "@wheresmycoleslaw/capability/repository-mine";

const report = await mineGitHubRepository("owner/repo", {
  query: "convert STEP to STL",
  maxFiles: 200,
  maxCandidates: 100
});
```

Set `GITHUB_TOKEN` (or pass `githubToken`) for higher GitHub API limits and private-repository metadata access where the underlying GitHub/raw endpoints permit it.

## MCP

The Capability bootstrap server exposes `capability_mine_repository`, allowing an MCP-connected agent to move from broad software-world search to evidence-based comprehension of a selected GitHub repository without executing repository code.

The intended progression is:

```text
search the software world
        ↓
select repository
        ↓
mine candidate abilities
        ↓
inspect evidence + uncertainty
        ↓
adapt a specific operation
        ↓
verify artifact + authority
        ↓
authorize / isolate / execute
        ↓
receipt
```
