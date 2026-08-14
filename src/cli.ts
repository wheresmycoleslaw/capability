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
import { assessCapabilityTrust, strictNpmTrustPolicy } from "./trust.js";
import { createCapabilityIndex, packageExportsToIndexCapabilities, type PublicIndexPackage } from "./public-index.js";
import type { PackageJsonWithCapabilities } from "./package.js";
import { capabilitiesFromOpenApi } from "./openapi.js";
import { CapabilityHub, DEFAULT_CAPABILITY_INDEX_URL, capabilityDoctor } from "./ecosystem.js";
import { AutoIsolatedExecutor, DockerExecutor } from "./docker.js";
import { InProcessExecutor, NodePermissionExecutor } from "./executor.js";
import { NpmPackageInstaller, VerifiedNpmPackageInstaller } from "./installer.js";
import { writeCapabilityLock } from "./lockfile.js";

function usage(): never {
  console.error(`capability CLI

Live ecosystem:
  cap find <query> [--index <url>] [--limit <n>]
  cap info <id-or-query> [--index <url>]
  cap install <id-or-query> [--index <url>] [--lock <path>]
  cap exec <id-or-query> <json-input> [--approve] [--index <url>] [--executor auto|docker|node|in-process]
  cap doctor [--index <url>]

Local/package tools:
  cap validate <manifest.json>
  cap package <package.json>
  cap acquire <package.json> <capability-id>
  cap plan <package.json> <capability-id> <json-input>
  cap run <package.json> <capability-id> <json-input> [--approve]
  cap find-local <query> <package.json...>
  cap eval <package.json> <capability-id> <cases.json> [--approve]
  cap trust <package.json> <capability-id>
  cap index <output.json> <package.json...>
  cap openapi <openapi.json> [namespace]
  cap mcp-tools <package.json...>`);
  process.exit(1);
}

function parseJson(value = "{}") { return JSON.parse(value) as unknown; }
function takeOption(args: string[], name: string): string | undefined {
  const exact = args.indexOf(name);
  if (exact >= 0) {
    const value = args[exact + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`${name} requires a value`);
    args.splice(exact, 2);
    return value;
  }
  const prefix = `${name}=`;
  const inline = args.findIndex((arg) => arg.startsWith(prefix));
  if (inline >= 0) return args.splice(inline, 1)[0]!.slice(prefix.length);
  return undefined;
}
function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}
function liveIndexes(args: string[]): string[] {
  const urls: string[] = [];
  let value: string | undefined;
  while ((value = takeOption(args, "--index"))) urls.push(value);
  return urls.length ? urls : [DEFAULT_CAPABILITY_INDEX_URL];
}
function executorFrom(name: string | undefined) {
  if (!name || name === "auto") return { executor: new AutoIsolatedExecutor(), loadCode: false };
  if (name === "docker") return { executor: new DockerExecutor(), loadCode: false };
  if (name === "node") return { executor: new NodePermissionExecutor(() => ({ requireNetworkIsolation: true })), loadCode: false };
  if (name === "in-process") return { executor: new InProcessExecutor(), loadCode: true };
  throw new TypeError(`Unknown executor: ${name}`);
}
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

async function liveHub(args: string[], executorName?: string) {
  const indexes = liveIndexes(args);
  const selected = executorFrom(executorName);
  return new CapabilityHub({
    indexes,
    executor: selected.executor,
    loadCode: selected.loadCode,
    installer: selected.loadCode ? new NpmPackageInstaller({ verifySignatures: true }) : new VerifiedNpmPackageInstaller(),
    trust: strictNpmTrustPolicy
  });
}

async function main() {
  const [, , command, ...rawArgs] = process.argv;
  if (!command) usage();
  const args = [...rawArgs];

  if (command === "doctor") {
    const index = takeOption(args, "--index") ?? DEFAULT_CAPABILITY_INDEX_URL;
    if (args.length) usage();
    const report = await capabilityDoctor({ index });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  if (command === "find" || command === "info" || command === "install" || command === "exec") {
    if (command === "find") {
      const limitRaw = takeOption(args, "--limit");
      const indexes = liveIndexes(args);
      const query = args.shift() ?? usage();
      if (args.length) usage();
      const hub = new CapabilityHub({ indexes });
      const results = await hub.discover({ text: query, limit: limitRaw ? Number.parseInt(limitRaw, 10) : 10 });
      console.log(JSON.stringify(results.map((entry) => ({
        id: entry.capability.manifest.id,
        capabilityVersion: entry.capability.manifest.version,
        name: entry.capability.manifest.name,
        description: entry.capability.manifest.description,
        effects: entry.capability.manifest.effects ?? [],
        package: `${entry.package.name}@${entry.package.version}`,
        score: entry.score,
        reasons: entry.reasons
      })), null, 2));
      return;
    }

    const executorName = command === "exec" ? takeOption(args, "--executor") : undefined;
    const approve = command === "exec" ? takeFlag(args, "--approve") : false;
    const lockPath = command === "install" ? (takeOption(args, "--lock") ?? "capability.lock.json") : undefined;
    const hub = await liveHub(args, executorName);
    const queryOrId = args.shift() ?? usage();

    if (command === "info") {
      if (args.length) usage();
      const selected = await hub.resolve(queryOrId);
      console.log(JSON.stringify(selected, null, 2));
      return;
    }

    if (command === "install") {
      if (args.length) usage();
      const lock = await hub.createLock(queryOrId);
      await writeCapabilityLock(lockPath!, lock);
      console.log(JSON.stringify({ installed: `${lock.package.name}@${lock.package.version}`, capability: `${lock.capability.id}@${lock.capability.version}`, lock: resolve(lockPath!) }, null, 2));
      return;
    }

    const input = parseJson(args.shift());
    if (args.length) usage();
    const result = await hub.run(queryOrId, input, { approved: approve });
    console.log(JSON.stringify({
      capability: result.receipt.capability,
      package: `${result.installed.packageName}@${result.installed.packageVersion}`,
      trust: result.trust,
      receipt: result.receipt
    }, null, 2));
    return;
  }

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
  if (command === "find-local") {
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
