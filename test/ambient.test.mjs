import test from "node:test";
import assert from "node:assert/strict";
import { createAmbientCapabilityLayer, AMBIENT_AGENT_INSTRUCTIONS } from "../dist/ambient.js";
import { AbilityProviderRegistry, defineAbilityProvider } from "../dist/need.js";

test("ambient layer silently executes a prepared low-risk ability", async () => {
  let executions = 0;
  const providers = new AbilityProviderRegistry().register(defineAbilityProvider({
    id: "host/prepared",
    kind: "connector",
    priority: 1,
    description: "Abilities already prepared by the host agent",
    async discover({ intent }) {
      return intent.includes("normalize")
        ? [{ kind: "connector", id: "host/normalize", ready: true, executionReady: true, trusted: true, score: 1, effects: [], authorityComplete: true }]
        : [];
    },
    async execute(_candidate, { input }) {
      executions += 1;
      return { output: { normalized: String(input?.text ?? "").trim().toLowerCase() } };
    }
  }));

  const layer = createAmbientCapabilityLayer({ providers });
  const result = await layer.resolveMissing("normalize this text", { input: { text: "  HELLO  " } });

  assert.equal(result.mode, "ambient-fallback");
  assert.equal(result.state, "executed");
  assert.equal(result.visibility, "silent");
  assert.equal(result.requiresUserAction, false);
  assert.deepEqual(result.resolution?.result, { normalized: "hello" });
  assert.equal(executions, 1);
});

test("ambient layer surfaces consequential authority instead of auto-approving", async () => {
  let executions = 0;
  const providers = new AbilityProviderRegistry().register(defineAbilityProvider({
    id: "host/mail",
    kind: "connector",
    priority: 1,
    description: "Prepared email provider",
    async discover() {
      return [{ kind: "connector", id: "mail/send", ready: true, executionReady: true, trusted: true, score: 1, effects: ["email.send"], authorityComplete: true }];
    },
    async execute() {
      executions += 1;
      return { output: { sent: true } };
    }
  }));

  const layer = createAmbientCapabilityLayer({ providers });
  const result = await layer.resolveMissing("send this email", { input: { to: "person@example.com" } });

  assert.equal(result.state, "approval_required");
  assert.equal(result.visibility, "surface");
  assert.equal(result.requiresUserAction, true);
  assert.equal(result.approval?.code, "APPROVAL_REQUIRED");
  assert.equal(executions, 0);
});

test("ambient layer can continue after explicit approval supplied by the host", async () => {
  let executions = 0;
  const providers = new AbilityProviderRegistry().register(defineAbilityProvider({
    id: "host/mail",
    kind: "connector",
    priority: 1,
    description: "Prepared email provider",
    async discover() {
      return [{ kind: "connector", id: "mail/send", ready: true, executionReady: true, trusted: true, score: 1, effects: ["email.send"], authorityComplete: true }];
    },
    async execute() {
      executions += 1;
      return { output: { sent: true } };
    }
  }));

  const layer = createAmbientCapabilityLayer({ providers });
  const result = await layer.resolveMissing("send this email", { approved: true, input: { to: "person@example.com" } });

  assert.equal(result.state, "executed");
  assert.equal(result.visibility, "silent");
  assert.deepEqual(result.resolution?.result, { sent: true });
  assert.equal(executions, 1);
});

test("ambient layer never turns external discovery into silent arbitrary execution", async () => {
  const fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "registry.npmjs.org") {
      const query = parsed.searchParams.get("text") ?? "";
      return new Response(JSON.stringify({ objects: query.toLowerCase().includes("camel") ? [{ package: { name: "camelcase", version: "9.0.0", description: "Convert separated strings to camel case", keywords: ["camelcase"], links: { repository: "https://github.com/sindresorhus/camelcase" } } }] : [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (parsed.hostname === "api.github.com") return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error(`unexpected URL: ${url}`);
  };

  const layer = createAmbientCapabilityLayer({ externalOnly: true, fetch });
  const result = await layer.resolveMissing("convert separated text to camel case");

  assert.equal(result.state, "resolved");
  assert.equal(result.visibility, "silent");
  assert.equal(result.requiresUserAction, false);
  assert.equal(result.resolution?.candidate?.id, "npm:camelcase@9.0.0");
  assert.equal(result.resolution?.candidate?.executionReady, false);
  assert.equal(result.resolution?.candidate?.authorityComplete, false);
});

test("host can use ambient resolution in discovery-only mode", async () => {
  let executions = 0;
  const providers = new AbilityProviderRegistry().register(defineAbilityProvider({
    id: "host/prepared",
    kind: "connector",
    priority: 1,
    description: "Prepared host abilities",
    async discover() {
      return [{ kind: "connector", id: "host/read", ready: true, executionReady: true, trusted: true, score: 1, effects: [], authorityComplete: true }];
    },
    async execute() { executions += 1; return { output: true }; }
  }));

  const layer = createAmbientCapabilityLayer({ providers, autoExecute: false });
  const result = await layer.resolveMissing("read a prepared value");
  assert.equal(result.state, "resolved");
  assert.equal(result.visibility, "silent");
  assert.equal(executions, 0);
});

test("ambient integration instructions encode invisible fallback semantics", () => {
  assert.match(AMBIENT_AGENT_INSTRUCTIONS, /ambient missing-ability layer/i);
  assert.match(AMBIENT_AGENT_INSTRUCTIONS, /without requiring the user to mention Capability/i);
  assert.match(AMBIENT_AGENT_INSTRUCTIONS, /explicit approval/i);
});
