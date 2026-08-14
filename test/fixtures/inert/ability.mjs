throw new Error("THIS MODULE MUST NOT BE IMPORTED DURING SAFE ACQUISITION");

export default {
  manifest: {
    specVersion: "0.1",
    id: "fixture/inert",
    version: "1.0.0",
    name: "Inert Fixture",
    description: "Fixture used to prove acquisition does not import executable code.",
    input: { type: "object" },
    output: { type: "object" },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false }
  },
  execute() { return {}; }
};
