import test from "node:test";
import assert from "node:assert/strict";
import { AbilityProviderRegistry, defineAbilityProvider, need } from "../src/need.js";

const connectorProvider = defineAbilityProvider({
  id: "test/connectors",
  kind: "connector",
  priority: 10,
  description: "Prepared production integrations",
  async discover({ intent }) {
    return intent.includes("email")
      ? [{ kind: "connector", id: "gmail/send", description: "Send email", ready: true, trusted: true, score: 1 }]
      : [];
  },
  async execute(candidate, { input }) {
    return { candidate: candidate.id, input };
  }
});

test("need prefers a prepared provider before software-world fallback", async () => {
  const providers = new AbilityProviderRegistry().register(connectorProvider);
  const resolution = await need("send an email", { providers });
  assert.equal(resolution.status, "ready");
  assert.equal(resolution.provider, "test/connectors");
  assert.equal(resolution.source, "connector");
  assert.equal(resolution.candidate?.id, "gmail/send");
  assert.deepEqual(resolution.considered, [{ provider: "test/connectors", kind: "connector", candidates: 1 }]);
});

test("need can execute a prepared provider through the same front door", async () => {
  const providers = new AbilityProviderRegistry().register(connectorProvider);
  const resolution = await need("send an email", { providers, execute: true, input: { to: "person@example.com" } });
  assert.equal(resolution.status, "executed");
  assert.deepEqual(resolution.result, { candidate: "gmail/send", input: { to: "person@example.com" } });
});

test("provider priority is explicit and deterministic", () => {
  const providers = new AbilityProviderRegistry()
    .register({ ...connectorProvider, id: "late", priority: 50 })
    .register({ ...connectorProvider, id: "early", priority: 5 });
  assert.deepEqual(providers.list().map((provider) => provider.id), ["early", "late"]);
});
