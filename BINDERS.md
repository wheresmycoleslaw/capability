# Metabolic Binders

A Capability metabolic binder adapts a **class of software** to the stable Capability 1.x execution contract.

The abstraction exists so metabolic coverage grows by substrate instead of by project-specific integrations.

```text
                   MetabolicBinder
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
     npm/Node         PyPI/Python        OCI
        │                │                │
   many projects     many packages    many images
```

Future binders can target WASM, Rust binaries, Go modules/binaries, JVM/JAR, .NET assemblies, signed native packages, or execution substrates that do not exist yet.

## Stable 1.x interface

```ts
export interface MetabolicBinder<
  Request = unknown,
  Binding extends MetabolicBinding = MetabolicBinding
> {
  readonly id: string;
  readonly substrate: string;
  readonly discovery: "automatic" | "explicit" | "derived";
  readonly description: string;

  bind(request: Request): Promise<Binding>;
  execute?(
    binding: Binding,
    input: unknown,
    context?: BinderExecutionContext
  ): Promise<BinderExecutionPayload>;
}
```

This is a public 1.x extension contract. Incompatible changes require a new Capability major version.

## Binding is the trust boundary, not a convenience object

A conformant binding must use the stable envelope:

```ts
{
  bindingVersion: "1.0",
  binderId: "example/wasm",
  substrate: "wasm",
  locator: "vendor/tool:latest",
  immutableArtifact: "sha256:...",
  createdAt: "...",
  authority: {
    complete: false,
    effects: ["custom:external.opaque-effects"]
  },
  evidence: ["sha256:...", "signature:..."]
}
```

`immutableArtifact` is required. A mutable tag, package range, branch name, floating URL or “latest” locator can be discovery input, but it is not an executable 1.x binding until the binder resolves it to an immutable identity appropriate to that substrate.

Examples include:

- npm package version + independently observed integrity;
- a PyPI wheel SHA256;
- an OCI `RepoDigest`;
- a Git commit plus bound package artifact;
- a WASM/component content digest;
- a signed binary digest and signature identity.

The exact identity scheme is substrate-specific. The requirement that an execution binding stop being mutable is protocol-level.

## Unknown authority stays unknown

If a binder cannot defensibly enumerate the complete effect surface, it must return:

```ts
authority: {
  complete: false,
  effects: [
    // any observed/inferred effects,
    "custom:external.opaque-effects"
  ]
}
```

Absence of evidence is not evidence of absence.

The 1.x registry validates this invariant. An incomplete binding without `custom:external.opaque-effects` is rejected.

## Approval is enforced outside the binder

`MetabolicBinderRegistry.execute()` refuses to call a binder with incomplete authority unless explicit approval is present.

This is intentional defense in depth. Individual binders may add stronger approval/policy checks, but the common registry boundary does not rely on every extension author remembering to implement the minimum invariant correctly.

## Stable registry-level receipt

A binder returns a low-level `BinderExecutionPayload`. The registry wraps it in a substrate-neutral `MetabolicExecutionReceipt` version `1.0` containing:

- binder and substrate identity;
- original locator;
- immutable artifact;
- authority state;
- binding evidence;
- execution status and timing;
- isolation label, when supplied;
- the substrate-specific upstream receipt, when supplied.

This means future binders can expose rich native evidence without forcing audit systems to understand every substrate before answering the basic question: **what exact thing ran under what authority?**

## Reference binders

Capability 1.0 ships reference binders for:

### npm / GitHub Forge

- software-world/GitHub discovery;
- exact repository mining;
- npm package identity and integrity;
- npm `gitHead` ↔ exact Git commit binding when available;
- generated private Capability sidecar;
- unknown upstream effects preserved;
- explicit approval;
- Docker first execution.

### PyPI / Python

- explicit package selection;
- non-yanked universal wheel selection;
- PyPI SHA256 verification;
- source mining without importing package code;
- exact wheel bytes retained;
- `--no-index --no-deps` installation;
- Docker build and runtime networking denied;
- pinned Python base-image digest.

### OCI / Docker

- mutable image tag resolved to immutable `RepoDigest`;
- read-only root filesystem;
- dropped Linux capabilities;
- `no-new-privileges`;
- PID/memory/CPU limits;
- network denied by default.

Artifact identity still does not prove that any of these artifacts are benign.

## Implementing a new binder

A new binder should answer five questions cleanly:

1. **What class of software does this binder cover?**
2. **How does a mutable discovery locator become an exact immutable artifact?**
3. **What evidence can be gathered without prematurely executing the artifact?**
4. **How is unknown authority represented rather than guessed away?**
5. **What real execution/isolation boundary invokes the artifact?**

Then run it through `runBinderConformance()` from `@wheresmycoleslaw/capability/conformance`.

See [CONFORMANCE.md](./CONFORMANCE.md) and [STABILITY.md](./STABILITY.md).

## What not to do

Do not call something a generalized binder if it:

- contains special cases for individual repositories as its primary strategy;
- defers immutable artifact resolution until after execution begins;
- marks authority complete because static analysis did not notice an effect;
- treats a digest as proof of safety;
- imports/executes arbitrary code merely to discover what it might do;
- bypasses Capability policy/approval because the substrate has its own permission system;
- discards the exact evidence that linked discovery to execution.

The purpose of the binder layer is not to make arbitrary software look safe. It is to make arbitrary software **legible enough to bind precisely and execute under an explicit boundary without lying about what remains unknown.**
