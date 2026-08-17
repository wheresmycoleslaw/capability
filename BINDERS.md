# Metabolic binders

Capability grows by **execution substrate**, not by writing one integration per repository.

A metabolic binder answers four questions for a class of software:

1. **How do I identify the exact artifact?**
2. **How do I expose one selected operation as a machine-readable ability?**
3. **What authority can I prove, and what must remain opaque?**
4. **What isolation boundary can execute the artifact without silently widening trust?**

The public `MetabolicBinder` interface and `MetabolicBinderRegistry` live in `src/binders.ts`.

```ts
interface MetabolicBinder<Request, Binding> {
  id: string;
  substrate: string;
  discovery: "automatic" | "explicit" | "derived";
  description: string;
  bind(request: Request): Promise<Binding>;
  execute?(binding: Binding, input: unknown, context?: BinderExecutionContext): Promise<BinderExecution>;
}
```

A binding carries an immutable artifact identity when the substrate supports one, evidence, and an authority statement. The reference implementation intentionally keeps generated external software authority-incomplete unless a stronger source can prove otherwise.

## Reference binders

### npm / GitHub Forge

- mines an ordinary GitHub repository;
- selects a root-callable JavaScript/TypeScript export or npm CLI;
- binds the published npm version and integrity;
- prefers npm `gitHead` ↔ exact Git commit evidence;
- preserves `custom:external.opaque-effects`;
- requires approval and Docker for first execution.

### PyPI / Python wheel

- accepts only a non-yanked universal wheel for the automatic binder;
- verifies the downloaded wheel bytes against PyPI SHA256 before mining;
- parses Python AST and entry-point metadata without importing the package;
- stores the exact verified wheel in the forged binding;
- builds the execution image from that exact wheel with `--no-index --no-deps` and Docker build networking disabled;
- executes with Docker networking disabled;
- records the wheel SHA256 and immutable Python base-image digest in the receipt.

Platform-specific wheels are deliberately rejected until a platform-aware binder can prove that the artifact matches the execution environment.

### OCI / Docker image

- pulls the requested image;
- resolves it to an immutable `RepoDigest`;
- executes that digest, not the mutable tag;
- drops Linux capabilities, enables `no-new-privileges`, makes the root filesystem read-only, limits PIDs/memory/CPU, and denies network by default;
- keeps the image's internal effects opaque.

## Adding a substrate

A useful binder should be generalized enough that an unrelated project using the same execution substrate can pass through it without project-specific code in Capability core.

Examples of future substrate binders include Rust/crates and binaries, Go modules/binaries, JVM artifacts, .NET assemblies, WASM modules, native package managers, and signed application bundles.

The invariant is more important than the ecosystem: **discover aggressively, bind exactly, preserve uncertainty, isolate execution, receipt the result.**
