import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capabilitiesFromMcpTools,
  connectStdioMcpCapabilities,
  createNpmCliBridgeDescriptor,
  discoverExternalSoftware,
  inspectNpmPackage,
  scaffoldNpmCliBridgeProject,
  validateCapabilityBridge
} from "../dist/index.js";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("external discovery searches npm and GitHub without pretending candidates are executable capabilities", async () => {
  const fetch = async (url) => {
    const text = String(url);
    if (text.startsWith("https://registry.npmjs.org/-/v1/search")) return jsonResponse({ objects: [{ package: { name: "alpha-cli", version: "2.0.0", description: "A useful CLI", keywords: ["cli"], links: { repository: "https://github.com/example/alpha" } } }] });
    if (text.startsWith("https://api.github.com/search/repositories")) return jsonResponse({ items: [{ full_name: "example/beta", description: "MCP example", html_url: "https://github.com/example/beta", topics: ["mcp"], stargazers_count: 42, language: "TypeScript", license: { spdx_id: "MIT" } }] });
    throw new Error(`unexpected URL ${text}`);
  };
  const result = await discoverExternalSoftware("automation", { fetch, limitPerSource: 5 });
  assert.equal(result.errors.length, 0);
  assert.equal(result.results.length, 2);
  const npm = result.results.find((entry) => entry.source === "npm");
  const github = result.results.find((entry) => entry.source === "github");
  assert.equal(npm.kind, "external");
  assert.ok(npm.adoption.some((entry) => entry.method === "npm-cli"));
  assert.ok(github.adoption.some((entry) => entry.method === "mcp"));
});

test("npm inspection finds exact published bins and native Capability declarations", async () => {
  const fetch = async () => jsonResponse({
    "dist-tags": { latest: "1.4.0" },
    versions: {
      "1.4.0": {
        name: "toolbox",
        version: "1.4.0",
        description: "Toolbox",
        bin: { toolbox: "bin/toolbox.js" },
        capability: { specVersion: "0.1", exports: {} },
        repository: { url: "git+https://github.com/example/toolbox.git" },
        dist: { integrity: "sha512-test", shasum: "abc123" }
      }
    }
  });
  const inspection = await inspectNpmPackage("toolbox", undefined, { fetch });
  assert.equal(inspection.version, "1.4.0");
  assert.deepEqual(inspection.bins, { toolbox: "bin/toolbox.js" });
  assert.equal(inspection.capabilityDeclared, true);
  assert.equal(inspection.repository, "https://github.com/example/toolbox");
  assert.equal(inspection.integrity, "sha512-test");
});

test("npm CLI sidecars keep unknown upstream effects visibly opaque until audited", async () => {
  const inspection = {
    source: "npm",
    name: "existing-tool",
    version: "3.2.1",
    description: "Existing tool",
    repository: "https://github.com/example/existing-tool",
    keywords: ["cli"],
    bins: { existing: "bin/existing.js" },
    capabilityDeclared: false,
    integrity: "sha512-upstream"
  };
  const opaque = createNpmCliBridgeDescriptor(inspection, { id: "external/existing", effects: ["filesystem.read"] });
  assert.deepEqual(validateCapabilityBridge(opaque), []);
  assert.ok(opaque.manifest.effects.includes("process.spawn"));
  assert.ok(opaque.manifest.effects.includes("environment.read"));
  assert.ok(opaque.manifest.effects.includes("custom:external.opaque-effects"));
  const audited = createNpmCliBridgeDescriptor(inspection, { id: "external/existing", effects: ["filesystem.read"], effectsComplete: true });
  assert.equal(audited.manifest.effects.includes("custom:external.opaque-effects"), false);
});

test("bridge scaffolding wraps an existing npm CLI without rewriting the upstream package", async () => {
  const directory = await mkdtemp(join(tmpdir(), "capability-bridge-"));
  try {
    const descriptor = createNpmCliBridgeDescriptor({
      source: "npm",
      name: "existing-tool",
      version: "3.2.1",
      description: "Existing tool",
      keywords: [],
      bins: { existing: "bin/existing.js" },
      capabilityDeclared: false
    }, { id: "external/existing" });
    const result = await scaffoldNpmCliBridgeProject(descriptor, { directory, packageName: "existing-tool-capability" });
    const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const source = await readFile(join(directory, "src/index.ts"), "utf8");
    const sidecar = JSON.parse(await readFile(join(directory, "capability.bridge.json"), "utf8"));
    assert.equal(pkg.dependencies["existing-tool"], "3.2.1");
    assert.equal(pkg.capability.exports["external/existing"].manifest.id, "external/existing");
    assert.match(source, /upstreamPackage = "existing-tool"/);
    assert.equal(sidecar.target.binPath, "bin/existing.js");
    assert.equal(result.upstream, "existing-tool@3.2.1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("existing MCP tools can be imported directly as conservative Capability contracts", async () => {
  const calls = [];
  const [capability] = capabilitiesFromMcpTools([{
    name: "send_report",
    title: "Send Report",
    description: "Send a report",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }], {
    namespace: "legacy-mcp",
    callTool: async (name, input) => { calls.push({ name, input }); return { structuredContent: { ok: true } }; }
  });
  assert.equal(capability.manifest.id, "legacy-mcp/send_report");
  assert.ok(capability.manifest.effects.includes("network.connect"));
  assert.ok(capability.manifest.effects.includes("custom:mcp.destructive"));
  assert.ok(capability.manifest.effects.includes("custom:mcp.opaque-effects"));
  assert.deepEqual(await capability.execute({ text: "hello" }), { ok: true });
  assert.deepEqual(calls, [{ name: "send_report", input: { text: "hello" } }]);
});

test("a stdio MCP server can become Capability-compatible without changing the server", async () => {
  const directory = await mkdtemp(join(tmpdir(), "capability-mcp-import-"));
  const server = join(directory, "server.mjs");
  await writeFile(server, `import { createInterface } from "node:readline";\nconst input = createInterface({ input: process.stdin, crlfDelay: Infinity });\nfor await (const line of input) {\n  const request = JSON.parse(line);\n  if (request.method === "notifications/initialized") continue;\n  let result = {};\n  if (request.method === "initialize") result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } };\n  if (request.method === "tools/list") result = { tools: [{ name: "echo", description: "Echo input", inputSchema: { type: "object" }, annotations: { readOnlyHint: true, idempotentHint: true } }] };\n  if (request.method === "tools/call") result = { structuredContent: { echo: request.params.arguments.value } };\n  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");\n}\n`, "utf8");
  const connected = await connectStdioMcpCapabilities({ command: process.execPath, args: [server], namespace: "fixture" });
  try {
    assert.equal(connected.tools.length, 1);
    assert.equal(connected.capabilities[0].manifest.id, "fixture/echo");
    assert.ok(connected.capabilities[0].manifest.effects.includes("process.spawn"));
    assert.deepEqual(await connected.capabilities[0].execute({ value: "hello" }), { echo: "hello" });
  } finally {
    connected.session.close();
    await rm(directory, { recursive: true, force: true });
  }
});
