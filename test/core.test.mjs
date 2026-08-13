import test from "node:test";
import assert from "node:assert/strict";
import {
  CapabilityCatalog,
  CapabilityError,
  CapabilityRegistry,
  CapabilityRuntime,
  EmbeddingRanker,
  NodePermissionExecutor,
  attachProvenance,
  composeCapabilities,
  createMcpAdapter,
  createPackageDeclaration,
  defineCapability,
  inspectCapability,
  inspectCapabilityPackage,
  loadCapabilityFromPackage,
  permissivePolicy,
  readOnlyPolicy,
  runCapability,
  runPipeline,
  validateManifest,
  validatePackageDeclaration
} from "../dist/index.js";

const add = defineCapability({
  manifest: {
    specVersion: "0.1", id: "math/add", version: "1.0.0", name: "Add", description: "Add two numbers",
    input: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"], additionalProperties: false },
    output: { type: "object", properties: { result: { type: "number" } }, required: ["result"], additionalProperties: false },
    effects: [], behavior: { deterministic: true, idempotent: true, reversible: false }, tags: ["math", "arithmetic"]
  },
  execute({ a, b }) { return { result: a + b }; },
  verify(output) { return { ok: Number.isFinite(output.result) }; }
});

test("inspection is inert", () => {
  let executed = false;
  const cap = defineCapability({ manifest: { specVersion: "0.1", id: "test/inert", version: "1.0.0", name: "Inert", description: "inspection", effects: [] }, execute() { executed = true; return 1; } });
  const inspection = inspectCapability(cap);
  assert.equal(executed, false);
  assert.equal(inspection.executable, false);
  assert.equal("execute" in inspection, false);
});

test("legacy definition remains runnable", async () => {
  const legacy = defineCapability({ name: "Legacy Add", description: "legacy", execute: ({ a, b }) => ({ result: a + b }) });
  assert.equal(legacy.manifest.id, "local/legacy-add");
  assert.deepEqual(await runCapability(legacy, { a: 20, b: 22 }), { result: 42 });
});

test("manifest validation rejects invalid identity/version", () => {
  assert.ok(validateManifest({ specVersion: "0.1", id: "bad", version: "v1", name: "x", description: "x" }).length >= 2);
});

test("runtime validates and receipts execution", async () => {
  const runtime = new CapabilityRuntime().register(add);
  await assert.rejects(() => runtime.invoke("math/add", { a: 1 }), (e) => e instanceof CapabilityError && e.code === "INVALID_INPUT");
  const receipt = await runtime.invoke("math/add", { a: 20, b: 22 });
  assert.equal(receipt.status, "succeeded");
  assert.deepEqual(receipt.output, { result: 42 });
  assert.equal(receipt.verification.ok, true);
  assert.ok(receipt.inputHash.length === 64 && receipt.outputHash.length === 64);
});

test("effectful capability is denied by default", async () => {
  const cap = defineCapability({ manifest: { specVersion: "0.1", id: "state/change", version: "1.0.0", name: "Change", description: "changes state", effects: ["database.write"] }, execute() { return true; } });
  const runtime = new CapabilityRuntime().register(cap);
  await assert.rejects(() => runtime.invoke("state/change", {}), (e) => e instanceof CapabilityError && e.code === "PERMISSION_DENIED");
});

test("mutating effects require approval under permissive policy", async () => {
  const cap = defineCapability({ manifest: { specVersion: "0.1", id: "state/change", version: "1.0.0", name: "Change", description: "changes state", effects: ["database.write"] }, execute() { return { ok: true }; } });
  const runtime = new CapabilityRuntime({ policy: permissivePolicy }).register(cap);
  const plan = await runtime.plan("state/change", {});
  assert.equal(runtime.authorize(plan).allowed, false);
  await assert.rejects(() => runtime.execute(plan), (e) => e instanceof CapabilityError && e.code === "APPROVAL_REQUIRED");
  assert.equal((await runtime.execute(plan, { approved: true })).status, "succeeded");
});

test("plan integrity detects drift", async () => {
  const runtime = new CapabilityRuntime().register(add);
  const plan = await runtime.plan("math/add", { a: 1, b: 2 });
  await assert.rejects(() => runtime.execute({ ...plan, input: { a: 100, b: 2 } }), (e) => e instanceof CapabilityError && e.code === "INVALID_PLAN");
});

test("rollback is explicit and receipted", async () => {
  const events = [];
  const cap = defineCapability({
    manifest: { specVersion: "0.1", id: "counter/increment", version: "1.0.0", name: "Increment", description: "increment", effects: ["database.write"], behavior: { reversible: true } },
    execute(input) { events.push(`add:${input.amount}`); return { amount: input.amount }; },
    rollback({ output }) { events.push(`undo:${output.amount}`); return { undone: output.amount }; }
  });
  const runtime = new CapabilityRuntime({ policy: permissivePolicy }).register(cap);
  const receipt = await runtime.invoke("counter/increment", { amount: 3 }, { approved: true });
  assert.equal((await runtime.rollback(receipt.receiptId, { approved: true })).status, "rolled_back");
  assert.deepEqual(events, ["add:3", "undo:3"]);
});

test("lexical discovery and semantic rankers are pluggable", async () => {
  const registry = new CapabilityRegistry().register(add);
  assert.equal(registry.discover("arithmetic add")[0].capability.manifest.id, "math/add");
  const ranker = new EmbeddingRanker(async (text) => text.includes("math/add") || text === "find arithmetic" ? [1, 0] : [0, 1]);
  assert.equal((await registry.discoverWith(ranker, "find arithmetic"))[0].capability.manifest.id, "math/add");
});

test("composition and pipelines preserve outputs and receipts", async () => {
  const double = defineCapability({ manifest: { specVersion: "0.1", id: "math/double", version: "1.0.0", name: "Double", description: "double", effects: [] }, execute(input) { return { result: input.result * 2 }; } });
  const combined = composeCapabilities({ manifest: { specVersion: "0.1", id: "math/combined", version: "1.0.0", name: "Combined", description: "add then double" }, steps: [add, double] });
  assert.deepEqual(await runCapability(combined, { a: 10, b: 11 }), { result: 42 });
  const runtime = new CapabilityRuntime().register(add).register(double);
  const pipeline = await runPipeline(runtime, ["math/add", "math/double"], { a: 10, b: 11 });
  assert.deepEqual(pipeline.output, { result: 42 });
  assert.equal(pipeline.receipts.length, 2);
});

test("MCP adapter projects and routes capabilities", async () => {
  const adapter = createMcpAdapter(new CapabilityRuntime().register(add));
  assert.equal(adapter.listTools().tools[0]._meta["capability/id"], "math/add");
  const result = await adapter.callTool({ name: "math__add", arguments: { a: 40, b: 2 } });
  assert.deepEqual(result.structuredContent, { result: 42 });
});

test("package declaration is validated", () => {
  const declaration = createPackageDeclaration({ "math/add": "./dist/add.js" });
  assert.equal(validatePackageDeclaration(declaration).length, 0);
  assert.ok(validatePackageDeclaration({ specVersion: "0.1", exports: { bad: "/absolute.js" } }).length > 0);
});

test("read-only policy is selective", async () => {
  const reader = defineCapability({ manifest: { specVersion: "0.1", id: "data/read", version: "1.0.0", name: "Read", description: "read data", effects: ["database.read"] }, execute() { return "ok"; } });
  const runtime = new CapabilityRuntime({ policy: readOnlyPolicy }).register(reader);
  assert.equal((await runtime.invoke("data/read", {})).output, "ok");
});

test("package metadata is inspectable before acquisition", async () => {
  const packagePath = new URL("./fixtures/package/package.json", import.meta.url).pathname;
  const inspected = await inspectCapabilityPackage(packagePath);
  assert.equal(inspected.manifests[0].id, "fixture/add");
  const capability = await loadCapabilityFromPackage(packagePath, "fixture/add");
  assert.deepEqual(await runCapability(capability, { a: 21, b: 21 }), { result: 42 });
});

test("catalog discovers inert metadata then acquires exact capability", async () => {
  const packagePath = new URL("./fixtures/package/package.json", import.meta.url).pathname;
  const catalog = new CapabilityCatalog();
  await catalog.indexPackage(packagePath);
  const matches = catalog.discover("fixture arithmetic add");
  assert.equal(matches[0].manifest.id, "fixture/add");
  assert.deepEqual(await runCapability(await catalog.acquire("fixture/add"), { a: 19, b: 23 }), { result: 42 });
});

test("provenance is copied into receipts", async () => {
  const cap = defineCapability({ manifest: { specVersion: "0.1", id: "provenance/test", version: "1.0.0", name: "Provenance", description: "test", effects: [] }, execute() { return 42; } });
  attachProvenance(cap, { packageName: "@fixture/test", packageVersion: "1.0.0", commit: "abc" });
  const receipt = await new CapabilityRuntime().register(cap).invoke("provenance/test", {});
  assert.equal(receipt.provenance.packageName, "@fixture/test");
  assert.equal(receipt.provenance.commit, "abc");
});

test("NodePermissionExecutor integrates out-of-process execution with receipts", async () => {
  const packagePath = new URL("./fixtures/package/package.json", import.meta.url).pathname;
  const capability = await loadCapabilityFromPackage(packagePath, "fixture/add");
  const runtime = new CapabilityRuntime({ executor: new NodePermissionExecutor() }).register(capability);
  const receipt = await runtime.invoke("fixture/add", { a: 39, b: 3 });
  assert.deepEqual(receipt.output, { result: 42 });
});
