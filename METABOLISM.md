# Capability Metabolism

Capability treats existing software as an **ability substrate** rather than requiring every useful operation to be authored for the protocol first.

The goal is **metabolic coverage**: increase the fraction of useful software that an agent can discover, understand, bind to an exact artifact, authorize, isolate, execute, verify, compose, and receipt without upstream modification.

```text
OUTCOME
  ↓
DISCOVER
  ↓
MINE EVIDENCE
  ↓
BIND EXACT ARTIFACT
  ↓
DERIVE CONTRACT + AUTHORITY
  ↓
AUTHORIZE
  ↓
ISOLATE + EXECUTE
  ↓
VERIFY + RECEIPT
  ↓
REUSE / COMPOSE
```

The unit of expansion is an **execution substrate**, not an individual repository. One generalized binder should unlock a class of existing software. The public `MetabolicBinder` interface and registry are documented in [BINDERS.md](./BINDERS.md).

## What “universal” means here

Capability 0.9 completes the **general architecture and feedback loop** for software metabolism; it does not claim that the reference implementation can execute every useful function in every software project.

A new software ecosystem should normally be added by implementing a generalized substrate binder rather than changing the protocol itself. The reference implementation proves several materially different substrates and leaves unsupported repository surfaces non-executable instead of fabricating a binding.

```text
universal architecture
≠
universal implementation coverage
```

## Capability 0.9 coverage

Run:

```bash
cap coverage
```

The reference implementation currently exposes these substrate families:

| Substrate | Discovery | Evidence / binding boundary | First execution |
| --- | --- | --- | --- |
| Capability-native | automatic | inert declared contract + exact package | normal Capability isolation |
| npm / Node | automatic through software-world search | GitHub mining + exact npm artifact; `gitHead` rebound when available | Docker for forged external software |
| PyPI / Python | explicit package selection | exact non-yanked universal wheel; SHA256 verified before mining and again before execution | Docker, network denied |
| OCI / Docker | explicit image selection | mutable tag resolved to immutable `RepoDigest` | the immutable image itself, hardened and network-denied by default |
| MCP | explicit server bootstrap | server-declared tool contracts imported conservatively | external MCP process boundary |
| OpenAPI | explicit document/service | OpenAPI operation contracts | remote HTTP boundary under Capability policy |
| Arbitrary repositories | automatic for GitHub candidates | exact commit + bounded source/docs/tests/examples evidence | non-executable until a real binder exists |
| Composition | derived from contracts | schema-compatible step chain + synthesized composite manifest | each step retains its own execution boundary and receipt |
| Capability gaps | derived when unresolved | machine-readable missing contract / authority ceiling / verification requirements | none until implemented |

This is deliberately **not** reported as a percentage of "all software." Such a number would be fake. Coverage is concrete: a substrate either has a defensible binder at a stated boundary or it does not.

## npm / GitHub Forge

The 0.8 Forge path remains the automatic software-world route for npm-backed JavaScript/TypeScript exports and CLIs:

```bash
cap solve "convert separated text to camel case" \
  --input '{"args":["hello capability world"]}' \
  --approve
```

A successful forged route can move through:

```text
outcome
→ npm/GitHub discovery
→ exact repository commit
→ mined public operation
→ exact npm package/version/integrity
→ npm gitHead ↔ Git commit when available
→ generated private Capability
→ opaque authority preserved
→ explicit approval
→ Docker first execution
→ receipt
```

The upstream project does not need to adopt Capability or be modified.

## PyPI / Python

Capability 0.9 adds an artifact-first Python binder.

```bash
cap pypi-inspect inflection
cap pypi-mine inflection --query "camelize text"
cap pypi-forge inflection \
  --query "camelize text" \
  --symbol camelize \
  --execute '{"args":["hello_world"]}' \
  --approve
```

The automatic Python binder intentionally accepts only a non-yanked **universal wheel** with a published SHA256. It then:

1. downloads the exact wheel;
2. verifies the wheel bytes against PyPI SHA256;
3. parses Python AST and `console_scripts` metadata directly from the wheel without importing the package;
4. stores the exact verified wheel in the private forged binding;
5. re-hashes those bytes before execution;
6. resolves the Python base image to an immutable Docker digest;
7. builds with Docker networking disabled and installs only that local wheel using `--no-index --no-deps`;
8. executes with networking disabled, a read-only root filesystem, dropped Linux capabilities, `no-new-privileges`, and resource limits;
9. receipts the wheel hash, base-image digest, operation and result.

Platform-specific wheels are rejected by this generalized binder until a platform-aware binder can prove the artifact matches the execution environment. Packages whose selected function requires undeclared transitive dependencies may fail under `--no-deps`; that failure is preferable to silently fetching code that was never part of the inspected artifact.

Use the higher-level route when the package is already known:

```bash
cap metabolize "camelize separated text" \
  --python inflection \
  --input '{"args":["hello_world"]}' \
  --approve
```

PyPI package selection is currently explicit; Capability does not pretend the PyPI JSON API is a semantic package search engine.

## OCI / container software

An OCI image is already a packaged execution environment, so Capability binds the image itself rather than reverse-engineering every language inside it.

```bash
cap oci-inspect busybox:1.36
cap oci-run busybox:1.36 echo capability-oci-ok --approve
```

The tag is resolved to an immutable `RepoDigest`. Execution uses that digest, not the mutable tag. The default boundary is read-only, capability-dropped, `no-new-privileges`, resource-limited and network-denied. The image's internal behavior still remains authority-incomplete; content addressability is provenance, not semantic safety.

## Runtime composition

A missing ability does not imply a missing program. The requested behavior may already exist across several unrelated capabilities.

For explicit multi-step intent, Capability can discover each step, reject known schema contradictions, synthesize a composite manifest, union the authority envelope, and optionally execute the pipeline while preserving a receipt for every step:

```bash
cap compose-intent "normalize text then slugify text"

cap compose-intent "normalize text then slugify text" \
  --input '{"text":"  Hello   Capability World  "}'
```

Conceptually:

```text
NEED X
  ↓
no single matching operation
  ↓
A produces schema S1
  ↓ compatible
B consumes S1 and produces S2
  ↓ compatible
C consumes S2
  ↓
synthesized composite contract
  ↓
union authority + per-step provenance
  ↓
A receipt → B receipt → C receipt
```

The current intent planner only auto-selects from Capability-native indexed contracts. The lower-level composition primitives accept arbitrary candidate contracts, so external binders can participate once they can supply defensible schemas. Capability does not guess compatibility where a known schema contradiction exists.

## Capability gaps: from failure to specification

When discovery and composition cannot defensibly satisfy an outcome, failure becomes data rather than a dead end.

```bash
cap gap "perform a missing operation" \
  --effect filesystem.read \
  --out missing.json
```

The resulting `CapabilityGap` records:

- the unresolved intent;
- optional input and output contracts;
- an authority ceiling;
- verification requirements;
- which substrate families were actually searched;
- native/external candidates considered;
- failed composition evidence.

The format has a JSON Schema in [`capability-gap.schema.json`](./capability-gap.schema.json).

That gap can become a normal Capability project without pretending the missing implementation already exists:

```bash
cap build-gap missing.json ./missing-capability
```

The generated project preserves `capability-gap.json`, its authority ceiling and its verification requirements. A human or coding agent can implement the exact missing software, run the normal Capability readiness/eval path, and then publish or federate it. This closes the feedback loop:

```text
NEED
 ↓
DISCOVER
 ↓
METABOLIZE EXISTING SOFTWARE
 ↓
COMPOSE
 ↓
unresolved?
 ↓
CAPABILITY GAP
 ↓
BUILD + VERIFY
 ↓
NEW CAPABILITY
 ↓
future discovery
```

## MCP bootstrap

Capability's MCP bridge now exposes metabolism itself instead of requiring the host to preload every possible tool:

- `capability_search`
- `capability_search_world`
- `capability_mine_repository`
- `capability_forge_repository`
- `capability_solve`
- `capability_metabolize`
- `capability_compose`
- `capability_coverage`
- `capability_inspect`
- `capability_execute`
- `capability_probe_site`
- `capability_doctor`

The surface stays small because discovery and acquisition are themselves tools.

## Trust boundary

**Metabolism is not trust.**

Capability separates:

```text
discovery ≠ inference ≠ artifact identity ≠ authority ≠ isolation ≠ correctness
```

External bindings remain authority-incomplete unless stronger evidence proves otherwise. Missing effect evidence never means an effect is absent. Generated bindings preserve opaque authority markers. Exact hashes and digests prove which bytes were selected; they do not prove the bytes are benign. Docker is a stronger execution boundary than in-process policy, but it is not an absolute hostile-code sandbox.

The governing rule is:

> Discover aggressively. Bind exactly. Preserve uncertainty. Authorize explicitly. Isolate execution. Keep evidence.
