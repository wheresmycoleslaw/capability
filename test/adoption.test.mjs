import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assessCapabilityNovelty,
  calculateAuthorityEnvelope,
  routeCapabilityContracts,
  assessReceiptDrift,
  calculateFailureFrontier,
  scaffoldCapabilityProject,
  assessProjectReadiness,
  validatePackageDeclaration
} from "../dist/index.js";

const baseManifest = {
  specVersion: "0.1",
  id: "image/inspect",
  version: "1.0.0",
  name: "Inspect Image",
  description: "Inspect image metadata without changing the source.",
  input: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  output: { type: "object", properties: { width: { type: "number" }, height: { type: "number" } }, required: ["width", "height"] },
  effects: ["filesystem.read"],
  behavior: { deterministic: true, idempotent: true, reversible: false },
  tags: ["image", "inspect"]
};

test("novelty radar rejects functional twins and rewards whitespace", () => {
  const twin = { ...baseManifest, id: "image/inspect-copy", version: "1.0.0", name: "Image Inspector" };
  const twinAssessment = assessCapabilityNovelty(twin, [baseManifest]);
  assert.equal(twinAssessment.classification, "functional-twin");
  assert.ok(twinAssessment.uniquenessScore < 20);

  const novel = {
    ...baseManifest,
    id: "agent/failure-frontier",
    name: "Failure Frontier",
    description: "Locate the first irreversible mutation in an agent execution graph and quantify compensation coverage.",
    input: { type: "object", properties: { steps: { type: "array" } }, required: ["steps"] },
    output: { type: "object", properties: { pointOfNoReturn: { type: "string" } }, required: ["pointOfNoReturn"] },
    effects: [],
    tags: ["agent", "rollback", "planning"]
  };
  const novelAssessment = assessCapabilityNovelty(novel, [baseManifest]);
  assert.ok(["distinct", "novel"].includes(novelAssessment.classification));
  assert.ok(novelAssessment.uniquenessScore > twinAssessment.uniquenessScore);
});

test("authority envelope exposes permission excess before execution", () => {
  const envelope = calculateAuthorityEnvelope([
    { ...baseManifest, id: "a/read", effects: ["filesystem.read"] },
    { ...baseManifest, id: "a/send", effects: ["network.connect", "email.send"], behavior: { deterministic: false, idempotent: false, reversible: false } }
  ], ["filesystem.read", "email.send"]);
  assert.deepEqual(envelope.overDeclaredEffects, ["network.connect"]);
  assert.deepEqual(envelope.perCapabilityOverDeclaration["a/send"], ["network.connect"]);
  assert.equal(envelope.fullyReversible, false);
  assert.ok(envelope.riskScore > 0);
});

test("contract router only chains structurally satisfiable consumers", () => {
  const routes = routeCapabilityContracts(
    { type: "object", properties: { text: { type: "string" }, count: { type: "number" } }, required: ["text", "count"] },
    [
      { id: "text/use", input: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
      { id: "number/use", input: { type: "object", properties: { count: { type: "string" } }, required: ["count"] } },
      { id: "missing/use", input: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }
    ]
  );
  assert.equal(routes[0].id, "text/use");
  assert.equal(routes[0].compatible, true);
  assert.equal(routes.find((route) => route.id === "number/use").compatible, false);
  assert.deepEqual(routes.find((route) => route.id === "missing/use").missing, ["path"]);
});

test("receipt drift catches same-input different-output behavior", () => {
  const baseline = {
    receiptId: "r1", planId: "p1", capability: { id: "x/run", version: "1.0.0" }, status: "succeeded",
    startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z", durationMs: 1000,
    effects: [], inputHash: "same", outputHash: "one", provenance: { packageName: "x", packageVersion: "1.0.0", packageIntegrity: "sha512-a" }
  };
  const current = { ...baseline, receiptId: "r2", outputHash: "two" };
  const drift = assessReceiptDrift(baseline, current);
  assert.equal(drift.reproducible, false);
  assert.ok(drift.changes.includes("same-input-different-output"));
  assert.ok(["high", "critical"].includes(drift.severity));
});

test("failure frontier identifies the first irreversible mutation", () => {
  const frontier = calculateFailureFrontier([
    { id: "read", effects: ["filesystem.read"], behavior: { idempotent: true, reversible: false } },
    { id: "write", effects: ["filesystem.write"], behavior: { idempotent: true, reversible: true } },
    { id: "send", effects: ["email.send"], behavior: { idempotent: false, reversible: false } }
  ]);
  assert.equal(frontier.pointOfNoReturn, "send");
  assert.deepEqual(frontier.approvalCheckpoints, ["write", "send"]);
  assert.equal(frontier.retrySafePrefixLength, 2);
  assert.equal(frontier.compensationCoverage, 50);
});

test("one-command scaffolder creates a publishable, safety-aware project", async () => {
  const root = await mkdtemp(join(tmpdir(), "capability-scaffold-"));
  const target = join(root, "signal-lattice");
  try {
    const result = await scaffoldCapabilityProject({
      directory: target,
      packageName: "signal-lattice",
      capabilityId: "signal/lattice",
      description: "Build a signal lattice."
    });
    assert.equal(result.capabilityId, "signal/lattice");
    const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    assert.deepEqual(validatePackageDeclaration(pkg.capability), []);
    assert.equal(pkg.dependencies["@wheresmycoleslaw/capability"], "^0.4.0");
    const readiness = await assessProjectReadiness(join(target, "package.json"));
    assert.equal(readiness.ok, true);
    assert.ok(readiness.score >= 85);
    assert.match(await readFile(join(target, ".github/workflows/publish.yml"), "utf8"), /id-token: write/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
