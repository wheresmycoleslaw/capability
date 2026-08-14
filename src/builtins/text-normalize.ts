import { defineCapability } from "../define.js";

export default defineCapability<{ text: string; trim?: boolean; collapseWhitespace?: boolean; case?: "preserve" | "lower" | "upper" }, { text: string }>({
  manifest: {
    specVersion: "0.1",
    id: "text/normalize",
    version: "1.0.0",
    name: "Normalize Text",
    description: "Normalize whitespace, surrounding space, and letter case in text without network or filesystem access.",
    input: {
      type: "object",
      properties: {
        text: { type: "string" },
        trim: { type: "boolean" },
        collapseWhitespace: { type: "boolean" },
        case: { type: "string", enum: ["preserve", "lower", "upper"] }
      },
      required: ["text"]
    },
    output: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    tags: ["text", "normalize", "whitespace", "case"]
  },
  execute(input: { text: string; trim?: boolean; collapseWhitespace?: boolean; case?: "preserve" | "lower" | "upper" }) {
    let text = input.text;
    if (input.trim !== false) text = text.trim();
    if (input.collapseWhitespace !== false) text = text.replace(/\s+/g, " ");
    if (input.case === "lower") text = text.toLowerCase();
    if (input.case === "upper") text = text.toUpperCase();
    return { text };
  }
});
