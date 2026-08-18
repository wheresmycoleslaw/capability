import test from "node:test";
import assert from "node:assert/strict";
import { AbilityProviderRegistry, defineAbilityProvider, providerFromCapabilities, need } from "../dist/need.js";
import { defineCapability } from "../dist/define.js";

test("need prefers a prepared provider before software-world fallback", async () => {
  const provider = defineAbilityProvider({
    id: "test/connectors",
    kind: "connector",
    priority: 10,
    description: "Prepared production integrations",
    async discover({ intent }) {
      return intent.includes("email")
        ? [{ kind: "connector", id: "gmail/send", description: "Send email", ready: true, trusted: true, score: 1, effects: ["email.send"], authorityComplete: true }]
        : [];
    },
    async execute(candidate, { input }) {
      return { output: { candidate: candidate.id, input }, receipt: { provider: "test" } };
    }
  });
  const providers = new AbilityProviderRegistry().register(provider);
  const resolution = await need("send an email", { providers });
  assert.equal(resolution.status, "ready");
  assert.equal(resolution.provider, "test/connectors");
  assert.equal(resolution.source, "connector");
  assert.equal(resolution.candidate?.id, "gmail/send");
  assert.deepEqual(resolution.considered, [{ provider: "test/connectors", kind: "connector", candidates: 1 }]);
});

test("need centrally approval-gates prepared providers before execution", async () => {
  const provider = defineAbilityProvider({
    id: "test/connectors",
    kind: "connector",
    priority: 10,
    description: "Prepared production integrations",
    async discover() {
      return [{ kind: "connector", id: "gmail/send", ready: true, trusted: true, score: 1, effects: ["email.send"], authorityComplete: true }];
    },
    async execute(candidate, { input }) {
      return { output: { candidate: candidate.id, input }, receipt: { provider: "test" } };
    }
  });
  const providers = new AbilityProviderRegistry().register(provider);
  await assert.rejects(
    () => need("send an email", { providers, execute: true, input: { to: "person@example.com" } }),
    (error) => error?.code === "APPROVAL_REQUIRED"
  );
  const resolution = await need("send an email", { providers, execute: true, approved: true, input: { to: "person@example.com" } });
  assert.equal(resolution.status, "executed");
  assert.deepEqual(resolution.result, { candidate: "gmail/send", input: { to: "person@example.com" } });
  assert.equal(resolution.receipt?.receiptVersion, "0.1");
  assert.deepEqual(resolution.receipt?.provider, { id: "test/connectors", kind: "connector" });
  assert.deepEqual(resolution.receipt?.effects, ["email.send"]);
  assert.equal(resolution.receipt?.approved, true);
  assert.deepEqual(resolution.receipt?.upstreamReceipt, { provider: "test" });
  assert.equal(typeof resolution.receipt?.inputHash, "string");
  assert.equal(typeof resolution.receipt?.outputHash, "string");
});

test("provider priority is explicit and deterministic", () => {
  const base = {
    kind: "connector",
    description: "Prepared provider",
    async discover() { return []; }
  };
  const providers = new AbilityProviderRegistry()
    .register({ ...base, id: "late", priority: 50 })
    .register({ ...base, id: "early", priority: 5 });
  assert.deepEqual(providers.list().map((provider) => provider.id), ["early", "late"]);
});

test("providerFromCapabilities gives prepared tools normal runtime receipts", async () => {
  const capability = defineCapability({
    manifest: {
      specVersion: "0.1",
      id: "mail/send",
      version: "1.0.0",
      name: "Send email",
      description: "Send an email message",
      input: { type: "object", properties: { to: { type: "string" } }, required: ["to"] },
      output: { type: "object", properties: { sent: { type: "boolean" } }, required: ["sent"] },
      effects: [],
      behavior: { deterministic: true, idempotent: true, reversible: false }
    },
    execute() { return { sent: true }; }
  });
  const providers = new AbilityProviderRegistry().register(providerFromCapabilities({
    id: "prepared/mail",
    kind: "connector",
    description: "Prepared mail integration",
    priority: 10,
    trusted: true,
    capabilities: [capability]
  }));
  const resolution = await need("send email", { providers, execute: true, input: { to: "person@example.com" } });
  assert.equal(resolution.status, "executed");
  assert.deepEqual(resolution.result, { sent: true });
  assert.equal(resolution.receipt?.status, "succeeded");
  assert.equal(resolution.receipt?.upstreamReceipt?.status, "succeeded");
});

test("unknown prepared-provider authority requires approval by default", async () => {
  const providers = new AbilityProviderRegistry().register(defineAbilityProvider({
    id: "test/opaque",
    kind: "connector",
    priority: 10,
    description: "Opaque provider",
    async discover() {
      return [{ kind: "connector", id: "opaque/action", ready: true, score: 1 }];
    },
    async execute() { return { output: true }; }
  }));
  await assert.rejects(
    () => need("opaque action", { providers, execute: true }),
    (error) => error?.code === "APPROVAL_REQUIRED"
  );
});
