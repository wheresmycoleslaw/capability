import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  METABOLIC_BINDING_VERSION,
  MetabolicBinderRegistry,
  validateMetabolicBinding
} from "../dist/binders.js";
import { runProtocolConformance } from "../dist/conformance.js";
import { capabilityProtocolInfo, isCapabilityProtocolCompatible } from "../dist/protocol.js";
import { capabilityNetworkMcpTools } from "../dist/network-mcp.js";
import { createDefaultMetabolicBinderRegistry } from "../dist/default-binders.js";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(await readFile(new URL("../stability-lock.json", import.meta.url), "utf8"));
const cliSource = await readFile(new URL("../src/cli.ts", import.meta.url), "utf8");

test("Capability 1.x protocol inventory is explicit and compatible", () => {
  const info = capabilityProtocolInfo();
  assert.equal(info.protocolVersion, "1.0");
  assert.equal(info.stabilityLine, "1.x");
  assert.equal(info.formats.metabolicBinding, "1.0");
  assert.equal(info.formats.metabolicExecutionReceipt, "1.0");
  assert.equal(isCapabilityProtocolCompatible("1.0"), true);
  assert.equal(isCapabilityProtocolCompatible("1.7.3"), true);
  assert.equal(isCapabilityProtocolCompatible("2.0"), false);
});

test("reference protocol conformance passes without network access", async () => {
  const report = await runProtocolConformance();
  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.ok(report.checks.length >= 7);
  assert.ok(report.checks.every((entry) => entry.ok));
});

test("1.x stability lock is a compatibility floor", () => {
  assert.equal(packageJson.version, "1.0.0");
  assert.equal(lock.protocolVersion, "1.0");
  assert.equal(lock.stabilityLine, "1.x");

  for (const path of lock.packageExports) {
    assert.ok(Object.hasOwn(packageJson.exports, path), `missing locked package export ${path}`);
  }

  const mcpNames = new Set(capabilityNetworkMcpTools().map((tool) => tool.name));
  for (const name of lock.mcpTools) assert.ok(mcpNames.has(name), `missing locked MCP tool ${name}`);

  for (const command of lock.cliCommands) {
    assert.ok(cliSource.includes(`cap ${command}`) || cliSource.includes(`command === "${command}"`), `missing locked CLI command ${command}`);
  }

  assert.deepEqual(capabilityProtocolInfo().formats, lock.formats);
});

test("metabolic binding cannot defer immutable artifact identity", async () => {
  const registry = new MetabolicBinderRegistry().register({
    id: "test/mutable",
    substrate: "test",
    discovery: "explicit",
    description: "intentionally invalid binder",
    async bind() {
      return {
        bindingVersion: METABOLIC_BINDING_VERSION,
        binderId: "test/mutable",
        substrate: "test",
        locator: "thing:latest",
        immutableArtifact: "",
        createdAt: new Date().toISOString(),
        authority: { complete: false, effects: ["custom:external.opaque-effects"] },
        evidence: ["discovery:thing:latest"]
      };
    }
  });
  await assert.rejects(() => registry.bind("test/mutable", {}), /immutableArtifact is required/);
});

test("incomplete authority is preserved and centrally approval-gated", async () => {
  const binder = {
    id: "test/external",
    substrate: "test",
    discovery: "explicit",
    description: "external test binder",
    async bind() {
      return {
        bindingVersion: METABOLIC_BINDING_VERSION,
        binderId: "test/external",
        substrate: "test",
        locator: "test://mutable-name",
        immutableArtifact: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        createdAt: new Date().toISOString(),
        authority: { complete: false, effects: ["custom:external.opaque-effects"] },
        evidence: ["sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
      };
    },
    async execute(_binding, input) {
      return { status: "succeeded", output: input, isolation: "test-boundary", upstreamReceipt: { substrate: "test" } };
    }
  };
  const registry = new MetabolicBinderRegistry().register(binder);
  const binding = await registry.bind(binder.id, {});
  assert.deepEqual(validateMetabolicBinding(binding, binder), []);
  await assert.rejects(() => registry.execute(binder.id, binding, { value: "blocked" }), /explicit approval/);

  const execution = await registry.execute(binder.id, binding, { value: "allowed" }, { approved: true });
  assert.equal(execution.status, "succeeded");
  assert.equal(execution.receipt.receiptVersion, "1.0");
  assert.equal(execution.receipt.immutableArtifact, binding.immutableArtifact);
  assert.equal(execution.receipt.authority.complete, false);
  assert.deepEqual(execution.receipt.evidence, binding.evidence);
  assert.equal(execution.receipt.isolation, "test-boundary");
});

test("reference binders remain generalized by substrate", () => {
  const rows = createDefaultMetabolicBinderRegistry().list();
  assert.deepEqual(new Set(rows.map((entry) => entry.substrate)), new Set(["npm", "pypi", "oci"]));
  assert.ok(rows.every((entry) => entry.executable));
});
