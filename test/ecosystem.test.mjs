import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CapabilityHub,
  NodePermissionExecutor,
  PublicCapabilityIndex,
  acquireIndexedCapability,
  assessCapabilityTrust,
  attachProvenance,
  createCapabilityIndex,
  createCapabilityLock,
  defineCapability,
  fetchCapabilityNetwork,
  inspectModuleBackedCapability,
  loadCapabilityFromPackage,
  resolveCapabilityLock,
  resolveIndexedCapability,
  strictNpmTrustPolicy,
  validateCapabilityIndex
} from "../dist/index.js";

const fixturePackageJson = fileURLToPath(new URL("./fixtures/package/package.json", import.meta.url));
const fixtureRoot = dirname(fixturePackageJson);
const inertPackageJson = fileURLToPath(new URL("./fixtures/inert/package.json", import.meta.url));

const addManifest = {
  specVersion: "0.1",
  id: "fixture/add",
  version: "1.0.0",
  name: "Fixture Add",
  description: "Adds two numbers in a fixture.",
  input: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
  output: { type: "object", properties: { result: { type: "number" } }, required: ["result"] },
  effects: [],
  behavior: { deterministic: true, idempotent: true, reversible: false },
  tags: ["fixture", "math"]
};

function indexWith(version = "1.0.0") {
  return createCapabilityIndex([{
    name: "@fixture/capabilities",
    version,
    source: "npm",
    capabilities: [{ manifest: addManifest, module: "./add.mjs" }]
  }], new Date("2026-08-14T00:00:00Z"));
}

test("safe module-backed acquisition does not import executable code", async () => {
  const capability = await inspectModuleBackedCapability(inertPackageJson, "fixture/inert");
  assert.equal(capability.manifest.id, "fixture/inert");
  await assert.rejects(() => loadCapabilityFromPackage(inertPackageJson, "fixture/inert"), /MUST NOT BE IMPORTED/);
});

test("federated indexes are traversed, de-duplicated, and merged", async () => {
  const root = createCapabilityIndex([], new Date("2026-08-14T00:00:00Z"), { federates: ["https://index.test/leaf.json", "https://index.test/leaf.json"] });
  const leaf = indexWith();
  const fetchImpl = async (url) => {
    const body = String(url) === "https://index.test/root.json" ? root : leaf;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const network = await fetchCapabilityNetwork(["https://index.test/root.json"], { fetch: fetchImpl });
  assert.equal(network.sources.length, 2);
  assert.equal(network.index.packages.length, 1);
  assert.equal(new PublicCapabilityIndex(network.index).discover("add")[0].capability.manifest.id, "fixture/add");
});

test("exact capability resolution prefers the newest semantic version", () => {
  const old = indexWith("1.0.0");
  const newerManifest = { ...addManifest, version: "2.0.0" };
  const newer = createCapabilityIndex([{ name: "@fixture/new", version: "2.0.0", source: "npm", capabilities: [{ manifest: newerManifest, module: "./add.mjs" }] }]);
  const combined = { ...old, packages: [...old.packages, ...newer.packages] };
  const selected = resolveIndexedCapability(combined, "fixture/add");
  assert.equal(selected.capability.manifest.version, "2.0.0");
});

test("hub discovers, acquires inert metadata, then executes only inside executor boundary", async () => {
  const document = indexWith();
  const fetchImpl = async () => new Response(JSON.stringify(document), { status: 200, headers: { "content-type": "application/json" } });
  const installer = {
    async install(packageName, packageVersion) {
      return { root: fixtureRoot, packageJsonPath: fixturePackageJson, packageName, packageVersion };
    }
  };
  const hub = new CapabilityHub({
    indexes: ["https://index.test/root.json"], fetch: fetchImpl, installer,
    trust: { requirePackage: true }, executor: new NodePermissionExecutor(), loadCode: false
  });
  const result = await hub.run("fixture/add", { a: 20, b: 22 });
  assert.deepEqual(result.receipt.output, { result: 42 });
  assert.equal(result.capability.manifest.id, "fixture/add");
});

test("strict npm trust requires verified package provenance", () => {
  const capability = defineCapability({
    manifest: { specVersion: "0.1", id: "trust/verified", version: "1.0.0", name: "Verified", description: "verified", effects: [] },
    execute() { return true; }
  });
  attachProvenance(capability, {
    source: "file:///tmp/ability.mjs", packageName: "@fixture/trusted", packageVersion: "1.0.0",
    packageIntegrity: "sha512-example", registrySignatureVerified: true, provenanceVerified: true,
    attestation: "https://registry.example/attestation", verificationProvider: "test", verifiedAt: new Date().toISOString()
  });
  const assessment = assessCapabilityTrust(capability, strictNpmTrustPolicy);
  assert.equal(assessment.accepted, true);
  assert.ok(assessment.score >= 80);
});

test("capability lock pins index, package and capability identity", () => {
  const index = indexWith();
  const result = resolveIndexedCapability(index, "fixture/add");
  const lock = createCapabilityLock(result, "https://index.test/root.json", index, {
    root: fixtureRoot, packageJsonPath: fixturePackageJson, packageName: "@fixture/capabilities", packageVersion: "1.0.0", packageIntegrity: "sha512-test"
  });
  const resolved = resolveCapabilityLock(index, lock);
  assert.equal(resolved.capability.manifest.id, "fixture/add");
  assert.equal(lock.package.integrity, "sha512-test");
});

test("indexed acquisition rejects a manifest that differs from selected inert metadata", async () => {
  const selected = resolveIndexedCapability(indexWith(), "fixture/add");
  const poisoned = { ...selected, capability: { ...selected.capability, manifest: { ...selected.capability.manifest, description: "poisoned" } } };
  const installer = { async install(packageName, packageVersion) { return { root: fixtureRoot, packageJsonPath: fixturePackageJson, packageName, packageVersion }; } };
  await assert.rejects(() => acquireIndexedCapability(poisoned, { installer, trust: { requirePackage: true }, loadCode: false }), /does not match public index/);
});

test("the checked-in public root registry validates", async () => {
  const document = JSON.parse(await readFile(new URL("../registry/index.json", import.meta.url), "utf8"));
  assert.deepEqual(validateCapabilityIndex(document), []);
  const ids = new PublicCapabilityIndex(document).discover("").map((entry) => entry.capability.manifest.id);
  assert.deepEqual(new Set(ids), new Set([
    "text/normalize",
    "text/slugify",
    "data/sha256",
    "json/get",
    "capability/novelty-radar",
    "capability/authority-envelope",
    "capability/contract-router",
    "capability/receipt-drift",
    "capability/failure-frontier",
    "capability/substitution-certificate",
    "capability/contract-evolution",
    "capability/dominance-resolver"
  ]));
});
