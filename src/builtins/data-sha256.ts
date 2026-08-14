import { defineCapability } from "../define.js";
import { sha256 } from "../utils.js";

export default defineCapability<{ value: unknown }, { sha256: string }>({
  manifest: {
    specVersion: "0.1",
    id: "data/sha256",
    version: "1.0.0",
    name: "Stable SHA-256",
    description: "Compute a deterministic SHA-256 digest of a structured JSON-compatible value.",
    input: { type: "object", properties: { value: {} }, required: ["value"] },
    output: { type: "object", properties: { sha256: { type: "string" } }, required: ["sha256"] },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    tags: ["data", "hash", "sha256", "digest"]
  },
  execute({ value }) { return { sha256: sha256(value) }; }
});
