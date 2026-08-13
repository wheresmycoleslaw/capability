# Security Model

## Trust boundaries

A capability manifest is untrusted metadata until the package/source and execution environment are trusted.

The reference runtime enforces declared-effect policy **before** execution. In-process execution does not prove that the implementation obeys its manifest.

## Defaults

`CapabilityRuntime` defaults to `denyAllPolicy`. Capabilities declaring no effects can run; capabilities declaring effects are denied until the application supplies a policy.

`permissivePolicy` allows all declared effects but still requires explicit approval for mutating/open-world effects.

## Plans

Plans bind capability ID/version, input hash, effects, and plan data into a fingerprint. Modified inputs or plans are rejected.

This prevents accidental or opportunistic plan/execute drift inside the reference runtime. It is not a cryptographic signature from an external authority.

## Receipts

Receipts may contain input and output values. Applications handling secrets or regulated data SHOULD supply a custom receipt store that redacts, encrypts, or omits sensitive values.

## Provenance

`attachProvenance()` records observed source information. It does not itself verify npm attestations, Git commits, signatures, or organizations. Verify those with the relevant package/source system before treating provenance as trusted.

## Node permission sandbox

`runInNodePermissionSandbox()` launches a separate Node process with `--permission`, grants only requested filesystem/process permissions, and does not inherit the parent environment by default.

Important limitations:

- Node's Permission Model is defense-in-depth, not a hostile-code security boundary.
- Node 24 cannot restrict network access using the Permission Model; newer Node releases can add network permission controls.
- database clients, native extensions, OS syscalls, and non-Node executables can require stronger isolation.
- allowing child processes materially weakens the boundary.

Use containers, VMs, OS sandboxing, WASM, or remote workers for hostile/untrusted capability code.

## Reporting vulnerabilities

Open a private GitHub security advisory for vulnerabilities. Do not publish exploit details in a public issue before a fix is available.
