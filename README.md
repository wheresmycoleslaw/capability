# Capability

A minimal TypeScript implementation of an experimental standard for self-describing executable capabilities for AI agents.

## Status

Experimental — `0.0.1`.

## Lifecycle

```text
DISCOVER -> INSPECT -> AUTHORIZE -> EXECUTE -> VERIFY
```

## Install

```bash
npm install @wheresmycoleslaw/capability
```

## Example

```ts
import {
  defineCapability,
  inspectCapability,
  runCapability
} from "@wheresmycoleslaw/capability";

const add = defineCapability<
  { a: number; b: number },
  { result: number }
>({
  name: "add",
  description: "Add two numbers.",
  input: {
    type: "object",
    properties: {
      a: { type: "number" },
      b: { type: "number" }
    },
    required: ["a", "b"]
  },
  output: {
    type: "object",
    properties: {
      result: { type: "number" }
    },
    required: ["result"]
  },
  effects: {
    filesystem: { read: false, write: false },
    network: false,
    shell: false,
    environment: false
  },
  behavior: {
    deterministic: true,
    idempotent: true,
    reversible: true
  },
  execute({ a, b }) {
    return { result: a + b };
  }
});

const metadata = inspectCapability(add);
const output = await runCapability(add, { a: 20, b: 22 });
```

`inspectCapability()` returns metadata without exposing or running `execute()`.

## Security

In `0.0.1`, effect declarations are metadata only. The package does not yet sandbox code or enforce declared permissions.

## Specification

See [SPEC.md](./SPEC.md).

## License

MIT
