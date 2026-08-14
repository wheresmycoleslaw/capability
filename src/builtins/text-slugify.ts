import { defineCapability } from "../define.js";

type SlugifyInput = { text: string; separator?: string; lowercase?: boolean };

export default defineCapability<SlugifyInput, { slug: string }>({
  manifest: {
    specVersion: "0.1",
    id: "text/slugify",
    version: "1.0.0",
    name: "Slugify Text",
    description: "Convert text to a deterministic URL-friendly slug without external effects.",
    input: {
      type: "object",
      properties: { text: { type: "string" }, separator: { type: "string" }, lowercase: { type: "boolean" } },
      required: ["text"]
    },
    output: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    tags: ["text", "slug", "url", "normalize"]
  },
  execute({ text, separator = "-", lowercase = true }: SlugifyInput) {
    if (!separator || separator.length > 8 || /[A-Za-z0-9]/.test(separator)) throw new TypeError("separator must be 1-8 non-alphanumeric characters");
    let value = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    if (lowercase) value = value.toLowerCase();
    value = value.replace(/[^A-Za-z0-9]+/g, separator);
    const escaped = separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    value = value.replace(new RegExp(`^${escaped}+|${escaped}+$`, "g"), "");
    return { slug: value };
  }
});
