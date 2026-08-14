import test from "node:test";
import assert from "node:assert/strict";
import {
  assessCapabilityEvolution,
  certifyCapabilitySubstitution,
  resolveCapabilityDominance
} from "../dist/index.js";

function manifest(overrides = {}) {
  return {
    specVersion: "0.1",
    id: "demo/process",
    version: "1.0.0",
    name: "Process",
    description: "Process a value.",
    input: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    output: { type: "object", properties: { result: { type: "string" } }, required: ["result"] },
    effects: ["filesystem.read", "network.connect"],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    ...overrides
  };
}

test("substitution certificate accepts a lower-authority equal contract", () => {
  const original = manifest();
  const replacement = manifest({ version: "2.0.0", effects: ["filesystem.read"] });
  const certificate = certifyCapabilitySubstitution(
    original,
    replacement,
    { score: 80, provenanceVerified: true, registrySignatureVerified: true },
    { score: 90, provenanceVerified: true, registrySignatureVerified: true }
  );
  assert.equal(certificate.accepted, true);
  assert.deepEqual(certificate.authorityDelta.added, []);
  assert.deepEqual(certificate.authorityDelta.removed, ["network.connect"]);
  assert.match(certificate.certificate, /^sha256-/);
});

test("substitution certificate rejects authority expansion and weaker behavior", () => {
  const original = manifest({ effects: ["filesystem.read"] });
  const replacement = manifest({
    version: "2.0.0",
    effects: ["filesystem.read", "secrets.read"],
    behavior: { deterministic: false, idempotent: false, reversible: false }
  });
  const certificate = certifyCapabilitySubstitution(original, replacement, { score: 90 }, { score: 80 });
  assert.equal(certificate.accepted, false);
  assert.deepEqual(certificate.authorityDelta.added, ["secrets.read"]);
  assert.ok(certificate.behaviorRegressions.includes("determinism weakened"));
  assert.equal(certificate.trustRegression, true);
});

test("contract evolution treats authority reduction as a meaningful safe upgrade", () => {
  const previous = manifest();
  const next = manifest({ version: "1.1.0", effects: ["filesystem.read"] });
  const assessment = assessCapabilityEvolution(previous, next);
  assert.equal(assessment.classification, "authority-reducing");
  assert.equal(assessment.semverRecommendation, "minor");
});

test("contract evolution forces major review when output guarantees disappear", () => {
  const previous = manifest();
  const next = manifest({
    version: "2.0.0",
    output: { type: "object", properties: { message: { type: "string" } }, required: ["message"] }
  });
  const assessment = assessCapabilityEvolution(previous, next);
  assert.equal(assessment.classification, "breaking");
  assert.equal(assessment.semverRecommendation, "major");
  assert.ok(assessment.substitution.contractBreaking.some((item) => item.includes("result")));
});

test("dominance resolver preserves tradeoffs and removes strictly worse candidates", () => {
  const result = resolveCapabilityDominance([
    { manifest: manifest({ id: "demo/safe", effects: ["filesystem.read"], behavior: { deterministic: true, idempotent: true, reversible: true } }), trustScore: 95 },
    { manifest: manifest({ id: "demo/worse", effects: ["filesystem.read", "network.connect"], behavior: { deterministic: true, idempotent: true, reversible: false } }), trustScore: 80 },
    { manifest: manifest({ id: "demo/trusted-risky", effects: ["filesystem.read", "network.connect"], behavior: { deterministic: true, idempotent: true, reversible: true } }), trustScore: 100 }
  ]);
  assert.ok(result.frontier.some((candidate) => candidate.id === "demo/safe"));
  assert.ok(result.frontier.some((candidate) => candidate.id === "demo/trusted-risky"));
  assert.ok(result.dominated.some((candidate) => candidate.id === "demo/worse"));
});
