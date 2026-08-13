export default {
  manifest: {
    specVersion: "0.1", id: "fixture/add", version: "1.0.0", name: "Fixture Add", description: "Adds two numbers in a fixture.",
    input: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
    output: { type: "object", properties: { result: { type: "number" } }, required: ["result"] },
    effects: [], behavior: { deterministic: true, idempotent: true, reversible: false }, tags: ["fixture", "math"]
  },
  execute({ a, b }) { return { result: a + b }; }
};
