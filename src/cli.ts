#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectCapability } from "./define.js";
import { CapabilityRuntime } from "./runtime.js";
import { permissivePolicy } from "./policy.js";
import { validateManifest } from "./manifest.js";
import { inspectCapabilityPackage, loadCapabilityFromPackage } from "./acquire.js";
import { getProvenance } from "./provenance.js";
import { createMcpAdapter } from "./mcp.js";
import { CapabilityCatalog } from "./catalog.js";
import { runCapabilityEvals, type SerializableEvalCase } from "./evals.js";
import { assessCapabilityTrust } from "./trust.js";
import { createCapabilityIndex, packageExportsToIndexCapabilities, type PublicIndexPackage } from "./public-index.js";
import type { PackageJsonWithCapabilities } from "./package.js";
import { capabilitiesFromOpenApi } from "./openapi.js";

function usage(): never {
  console.error(`capability CLI\n\nCommands:\n  cap validate <manifest.json>\n  cap package <package.json>\n  cap acquire <package.json> <capability-id>\n  cap plan <package.json> <capability-id> <json-input>\n  cap run <package.json> <capability-id> <json-input> [--approve]\n  cap find <query> <package.json...>\n  cap eval <package.json> <capability-id> <cases.json> [--approve]\n  cap trust <package.json> <capability-id>\n  cap index <output.json> <package.json...>\n  cap openapi <openapi.json> [namespace]\n  cap mcp-tools <package.json...>`);
  process.exit(1);
}

function parseJson(value = "{}") { return JSON.parse(value) as unknown; }
async function runtimeForPackage(packageJsonPath: string, id: string) {
  const capability = await loadCapabilityFromPackage(packageJsonPath, id);
  const runtime = new CapabilityRuntime({ policy: permissivePolicy }).register(capability);
  return { capability, runtime };
}

async function indexPackageRecord(packageJsonPath: string): Promise<PublicIndexPackage> {
  const absolute = resolve(packageJsonPath);
  const packageJson = JSON.parse(await readFile(absolute, "utf8")) as PackageJsonWithCapabilities;
  if (!packageJson.name || !packageJson.version || !packageJson.capability) throw new Error(`${packageJsonPath} must contain name, version and capability metadata`);
  const repository = typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url;
  return { name: packageJson.name, version: packageJson.version, source: absolute, ...(repository ? { repository } : {}), capabilities: packageExportsToIndexCapabilities(packageJson.capability.exports) };
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command) usage();
  if (command === "validate") {
    const path = args[0] ?? usage();
    const issues = validateManifest(JSON.parse(await readFile(resolve(path), "utf8")));
    console.log(JSON.stringify({ valid: issues.length === 0, issues }, null, 2));
    process.exitCode = issues.length ? 1 : 0;
    return;
  }
  if (command === "package") { console.log(JSON.stringify(await inspectCapabilityPackage(args[0] ?? "package.json"), null, 2)); return; }
  if (command === "acquire" || command === "trust") {
    const [packageJsonPath, id] = args;
    if (!packageJsonPath || !id) usage();
    const capability = await loadCapabilityFromPackage(packageJsonPath, id);
    if (command === "trust") console.log(JSON.stringify(assessCapabilityTrust(capability), null, 2));
    else console.log(JSON.stringify({ manifest: inspectCapability(capability), provenance: getProvenance(capability) }, null, 2));
    return;
  }
  if (command === "plan" || command === "run") {
    const [packageJsonPath, id, inputJson] = args;
    if (!packageJsonPath || !id) usage();
    const { runtime } = await runtimeForPackage(packageJsonPath, id);
    const plan = await runtime.plan(id, parseJson(inputJson));
    if (command === "plan") console.log(JSON.stringify(plan, null, 2));
    else console.log(JSON.stringify(await runtime.execute(plan, { approved: args.includes("--approve") }), null, 2));
    return;
  }
  if (command === "find") {
    const query = args.shift() ?? usage();
    if (!args.length) usage();
    const catalog = new CapabilityCatalog();
    for (const packageJsonPath of args) await catalog.indexPackage(packageJsonPath);
    console.log(JSON.stringify(catalog.discover(query), null, 2));
    return;
  }
  if (command === "eval") {
    const [packageJsonPath, id, casesPath] = args;
    if (!packageJsonPath || !id || !casesPath) usage();
    const cases = JSON.parse(await readFile(resolve(casesPath), "utf8")) as SerializableEvalCase[];
    const { runtime } = await runtimeForPackage(packageJsonPath, id);
    console.log(JSON.stringify(await runCapabilityEvals(runtime, id, cases, { approved: args.includes("--approve") }), null, 2));
    return;
  }
  if (command === "index") {
    const [outputPath, ...packages] = args;
    if (!outputPath || !packages.length) usage();
    const records = await Promise.all(packages.map(indexPackageRecord));
    const index = createCapabilityIndex(records);
    await writeFile(resolve(outputPath), `${JSON.stringify(index, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ output: resolve(outputPath), packages: records.length, capabilities: records.reduce((sum, pkg) => sum + pkg.capabilities.length, 0) }, null, 2));
    return;
  }
  if (command === "openapi") {
    const [path, namespace] = args;
    if (!path) usage();
    const document = JSON.parse(await readFile(resolve(path), "utf8"));
    const capabilities = capabilitiesFromOpenApi(document, { namespace });
    console.log(JSON.stringify(capabilities.map(inspectCapability), null, 2));
    return;
  }
  if (command === "mcp-tools") {
    if (!args.length) usage();
    const runtime = new CapabilityRuntime({ policy: permissivePolicy });
    for (const packageJsonPath of args) {
      const inspected = await inspectCapabilityPackage(packageJsonPath);
      for (const entry of inspected.entries) runtime.register(await loadCapabilityFromPackage(packageJsonPath, entry.id));
    }
    console.log(JSON.stringify(createMcpAdapter(runtime).listTools(), null, 2));
    return;
  }
  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
