import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  createCapabilitySiteDocument,
  capabilityDiscoveryUrls,
  fetchCapabilitySiteDocument,
  probeCapabilitySite,
  validateCapabilitySiteDocument
} from "../dist/web-discovery.js";
import { CapabilityNetworkMcpBridge, capabilityNetworkMcpTools } from "../dist/network-mcp.js";

const index = {
  indexVersion: "0.1",
  generatedAt: "2026-08-15T00:00:00.000Z",
  packages: [],
  federates: []
};

function fakeFetch(routes) {
  return async (url) => {
    const value = routes[String(url)];
    if (value === undefined) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  };
}

test("site discovery document is deterministic and well-known", async () => {
  const document = createCapabilitySiteDocument({
    indexes: ["https://registry.example.test/index.json"],
    package: { name: "@example/capability-bridge", version: "1.0.0" },
    mcp: [{ transport: "stdio", command: "npx", args: ["-y", "@example/capability-bridge"] }],
    documentation: "https://example.test/capability"
  });
  assert.deepEqual(validateCapabilitySiteDocument(document), []);
  assert.deepEqual(capabilityDiscoveryUrls("https://example.test/anything"), [
    "https://example.test/.well-known/capabilities",
    "https://example.test/.well-known/capabilities.json"
  ]);
  const fetch = fakeFetch({
    "https://example.test/.well-known/capabilities": document,
    "https://registry.example.test/index.json": index
  });
  const found = await fetchCapabilitySiteDocument("https://example.test/path", fetch);
  assert.equal(found.url, "https://example.test/.well-known/capabilities");
  const probe = await probeCapabilitySite("https://example.test", { fetch });
  assert.equal(probe.document.package.name, "@example/capability-bridge");
  assert.equal(probe.indexes.length, 1);
});

test("MCP bootstrap bridge exposes network and software-world discovery primitives", () => {
  const names = capabilityNetworkMcpTools().map((tool) => tool.name);
  assert.deepEqual(names, [
    "capability_search",
    "capability_search_world",
    "capability_inspect",
    "capability_execute",
    "capability_probe_site",
    "capability_doctor"
  ]);
  const bridge = new CapabilityNetworkMcpBridge();
  assert.deepEqual(bridge.listTools().tools.map((tool) => tool.name), names);
});

test("stdio MCP bridge serves modern discovery and legacy initialize", async (t) => {
  const child = spawn(process.execPath, ["dist/mcp-server.js"], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill("SIGKILL"));
  const replies = [];
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const i = buffer.indexOf("\n");
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) replies.push(JSON.parse(line));
    }
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })}\n`);
  const deadline = Date.now() + 5000;
  while (replies.length < 3 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(replies.length, 3);
  assert.deepEqual(replies[0].result.supportedVersions, ["2026-07-28"]);
  assert.equal(replies[1].result.protocolVersion, "2025-11-25");
  assert.equal(replies[2].result.tools.some((tool) => tool.name === "capability_search_world"), true);
});
