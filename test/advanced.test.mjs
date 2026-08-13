import test from "node:test";
import assert from "node:assert/strict";
import {
  CapabilityRuntime,
  PublicCapabilityIndex,
  acquireIndexedCapability,
  assessCapabilityTrust,
  attachProvenance,
  capabilitiesFromOpenApi,
  createCapabilityIndex,
  defineCapability,
  evaluateDeterminism,
  fetchCapabilityIndex,
  permissivePolicy,
  runCapability,
  runCapabilityEvals,
  validateCapabilityIndex
} from "../dist/index.js";

const add = defineCapability({
  manifest: {
    specVersion: "0.1", id: "math/add", version: "1.0.0", name: "Add", description: "Add two numbers",
    input: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
    output: { type: "object", properties: { result: { type: "number" } }, required: ["result"] },
    effects: [], behavior: { deterministic: true, idempotent: true, reversible: false }, tags: ["math"]
  },
  execute({ a, b }) { return { result: a + b }; }
});

test("eval harness and determinism run through real runtime", async () => {
  const runtime = new CapabilityRuntime().register(add);
  const report = await runCapabilityEvals(runtime, "math/add", [
    { name: "20+22", input: { a: 20, b: 22 }, expectedOutput: { result: 42 } },
    { name: "1+2", input: { a: 1, b: 2 }, expectedOutput: { result: 3 } }
  ]);
  assert.equal(report.passRate, 1);
  const replay = await evaluateDeterminism(runtime, "math/add", { a: 20, b: 22 }, 3);
  assert.equal(replay.deterministic, true);
  assert.equal(new Set(replay.hashes).size, 1);
});

test("trust policy scores observed provenance", () => {
  const capability = defineCapability({ manifest: { specVersion: "0.1", id: "trust/test", version: "1.0.0", name: "Trust", description: "trust", effects: [] }, execute() { return true; } });
  attachProvenance(capability, {
    source: "file:///tmp/test.js", packageName: "@fixture/trusted", packageVersion: "1.0.0",
    integrity: "sha256-deadbeef", repository: "https://github.com/fixture/trusted", commit: "abc123", attestation: "example"
  });
  const assessment = assessCapabilityTrust(capability, { minScore: 90, requirePackage: true, requireIntegrity: true, requireRepository: true, requireCommit: true, requireAttestation: true, allowedPackages: ["@fixture/*"] });
  assert.equal(assessment.accepted, true);
  assert.equal(assessment.score, 100);
});

test("public index validates and discovers inert capabilities", () => {
  const document = createCapabilityIndex([{
    name: "@fixture/math", version: "1.0.0", source: "npm",
    capabilities: [{ manifest: add.manifest, module: "./add.mjs" }]
  }], new Date("2026-01-01T00:00:00Z"));
  assert.equal(validateCapabilityIndex(document).length, 0);
  const match = new PublicCapabilityIndex(document).discover("math add")[0];
  assert.equal(match.capability.manifest.id, "math/add");
});

test("remote public index fetch validates response", async () => {
  const document = createCapabilityIndex([{ name: "@fixture/math", version: "1.0.0", source: "npm", capabilities: [{ manifest: add.manifest, module: "./add.mjs" }] }]);
  const fetched = await fetchCapabilityIndex("https://index.example.test/capabilities.json", async () => new Response(JSON.stringify(document), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(fetched.packages[0].name, "@fixture/math");
});

test("OpenAPI 3.1 operations become policy-controlled capabilities", async () => {
  let request;
  const fakeFetch = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ id: "42", name: "Ada" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const [capability] = capabilitiesFromOpenApi({
    openapi: "3.1.0", info: { title: "People API", version: "1.2.3" }, servers: [{ url: "https://api.example.test" }],
    paths: { "/people/{id}": { get: { operationId: "getPerson", parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      { name: "verbose", in: "query", schema: { type: "boolean" } }
    ], responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } }, required: ["id", "name"] } } } } } } } } }
  }, { fetch: fakeFetch });
  assert.deepEqual(capability.manifest.effects, ["network.connect"]);
  const runtime = new CapabilityRuntime({ policy: permissivePolicy }).register(capability);
  const receipt = await runtime.invoke(capability.manifest.id, { path: { id: "42" }, query: { verbose: true } }, { approved: true });
  assert.deepEqual(receipt.output, { id: "42", name: "Ada" });
  assert.equal(request.url, "https://api.example.test/people/42?verbose=true");
});

test("indexed acquisition is installer-pluggable and trust-gated", async () => {
  const packageJsonPath = new URL("./fixtures/package/package.json", import.meta.url).pathname;
  const fixtureManifest = {
    specVersion: "0.1", id: "fixture/add", version: "1.0.0", name: "Fixture Add", description: "Adds two numbers in a fixture.",
    input: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
    output: { type: "object", properties: { result: { type: "number" } }, required: ["result"] },
    effects: [], behavior: { deterministic: true, idempotent: true, reversible: false }, tags: ["fixture", "math"]
  };
  const document = createCapabilityIndex([{ name: "@fixture/capabilities", version: "1.0.0", source: "npm", capabilities: [{ manifest: fixtureManifest, module: "./add.mjs" }] }]);
  const match = new PublicCapabilityIndex(document).discover("fixture add")[0];
  const installer = { async install(packageName, packageVersion) { return { root: new URL("./fixtures/package/", import.meta.url).pathname, packageName, packageVersion, packageJsonPath }; } };
  const acquired = await acquireIndexedCapability(match, { installer, trust: { requirePackage: true } });
  assert.equal(acquired.trust.accepted, true);
  assert.deepEqual(await runCapability(acquired.capability, { a: 20, b: 22 }), { result: 42 });
});
