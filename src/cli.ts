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
import { CapabilityHub, DEFAULT_CAPABILITY_INDEX_URL, capabilityDoctor, fetchCapabilityNetwork } from "./ecosystem.js";
import { AutoIsolatedExecutor, DockerExecutor } from "./docker.js";
import { InProcessExecutor, NodePermissionExecutor } from "./executor.js";
import { NpmPackageInstaller, VerifiedNpmPackageInstaller } from "./installer.js";
import { writeCapabilityLock } from "./lockfile.js";
import { assessCapabilityNovelty } from "./innovation.js";
import { assessProjectReadiness, scaffoldCapabilityProject } from "./scaffold.js";
import type { CapabilityEffect, CapabilityManifest } from "./types.js";
import { probeCapabilitySite } from "./web-discovery.js";
import { discoverSoftwareWorld, inspectNpmPackage } from "./external-discovery.js";
import { createNpmCliBridgeDescriptor, scaffoldNpmCliBridgeProject } from "./bridge.js";
import { connectStdioMcpCapabilities } from "./mcp-import.js";

function usage(): never {
  console.error(`capability CLI

Developer onboarding:
  cap create <directory> [--name <package>] [--id <capability-id>] [--description <text>] [--repo <url>] [--force]
  cap bridge npm <package> [directory] [--version <exact>] [--bin <name>] [--id <capability-id>] [--effect <effect>...] [--effects-complete] [--name <text>] [--description <text>] [--repo <url>] [--force]
  cap readiness [package.json]
  cap novelty <capability-id|manifest.json> [--package <package.json>] [--index <url>]
  cap registry-entry [package.json] [--out <path>]

Discovery and interoperability:
  cap world <query> [--index <url>] [--limit <n>] [--no-npm] [--no-github]
  cap npm-inspect <package> [--version <exact>]
  cap mcp-import <command> [command-args...] [--namespace <name>] [--version <semver>] [--effects-complete]
  cap probe <site>
  cap mcp-serve [--index <url>]
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
  cap openapi <openapi.json|url> [namespace]
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
function takeOptions(args: string[], name: string): string[] {
  const result: string[] = [];
  let value: string | undefined;
  while ((value = takeOption(args, name)) !== undefined) result.push(value);
  return result;
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

function repositoryUrl(packageJson: PackageJsonWithCapabilities): string | undefined {
  const raw = typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url;
  return raw?.replace(/^git\+/, "").replace(/\.git$/, "");
}

async function indexPackageRecord(packageJsonPath: string, source?: string): Promise<PublicIndexPackage> {
  const absolute = resolve(packageJsonPath);
  const packageJson = JSON.parse(await readFile(absolute, "utf8")) as PackageJsonWithCapabilities;
  if (!packageJson.name || !packageJson.version || !packageJson.capability) throw new Error(`${packageJsonPath} must contain name, version and capability metadata`);
  const repository = repositoryUrl(packageJson);
  return { name: packageJson.name, version: packageJson.version, source: source ?? absolute, ...(repository ? { repository } : {}), capabilities: packageExportsToIndexCapabilities(packageJson.capability.exports) };
}

async function localManifest(query: string, packageJsonPath: string): Promise<CapabilityManifest> {
  if (query.endsWith(".json")) {
    const value = JSON.parse(await readFile(resolve(query), "utf8")) as CapabilityManifest;
    const issues = validateManifest(value);
    if (issues.length) throw new TypeError(`Invalid manifest: ${issues.join("; ")}`);
    return value;
  }
  const pkg = JSON.parse(await readFile(resolve(packageJsonPath), "utf8")) as PackageJsonWithCapabilities;
  const entry = pkg.capability?.exports[query];
  if (!entry) throw new Error(`Capability ${query} was not found in ${packageJsonPath}`);
  if (typeof entry === "string") throw new Error(`${query} has no inert manifest; novelty analysis never imports executable code`);
  return entry.manifest;
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

async function readOpenApiSource(source: string): Promise<unknown> {
  if (!/^https?:\/\//i.test(source)) return JSON.parse(await readFile(resolve(source), "utf8"));
  const fetchImpl = globalThis.fetch;
  if (!fetchImpl) throw new TypeError("A fetch implementation is required for remote OpenAPI documents");
  const response = await fetchImpl(source, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Failed to fetch OpenAPI document: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const [, , command, ...rawArgs] = process.argv;
  if (!command) usage();
  const args = [...rawArgs];

  if (command === "mcp-serve") {
    const index = takeOption(args, "--index");
    if (args.length) usage();
    if (index) process.env.CAPABILITY_INDEX = index;
    await import("./mcp-server.js");
    return;
  }

  if (command === "world") {
    const limitRaw = takeOption(args, "--limit");
    const indexes = liveIndexes(args);
    const npm = !takeFlag(args, "--no-npm");
    const github = !takeFlag(args, "--no-github");
    const query = args.shift() ?? usage();
    if (args.length) usage();
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 10;
    console.log(JSON.stringify(await discoverSoftwareWorld(query, { indexes, limit, npm, github }), null, 2));
    return;
  }

  if (command === "npm-inspect") {
    const version = takeOption(args, "--version");
    const packageName = args.shift() ?? usage();
    if (args.length) usage();
    console.log(JSON.stringify(await inspectNpmPackage(packageName, version), null, 2));
    return;
  }

  if (command === "bridge") {
    const bridgeKind = args.shift() ?? usage();
    if (bridgeKind !== "npm") throw new TypeError(`Unknown bridge kind: ${bridgeKind}. Currently supported: npm`);
    const version = takeOption(args, "--version");
    const bin = takeOption(args, "--bin");
    const id = takeOption(args, "--id");
    const name = takeOption(args, "--name");
    const description = takeOption(args, "--description");
    const repository = takeOption(args, "--repo");
    const effects = takeOptions(args, "--effect") as CapabilityEffect[];
    const effectsComplete = takeFlag(args, "--effects-complete");
    const force = takeFlag(args, "--force");
    const packageName = args.shift() ?? usage();
    const directory = args.shift();
    if (args.length) usage();
    const inspection = await inspectNpmPackage(packageName, version);
    const descriptor = createNpmCliBridgeDescriptor(inspection, { id, bin, name, description, effects, effectsComplete });
    if (!directory) {
      console.log(JSON.stringify(descriptor, null, 2));
      return;
    }
    const result = await scaffoldNpmCliBridgeProject(descriptor, { directory, repository, force });
    console.log(JSON.stringify({ descriptor, project: result, next: [`cd ${result.directory}`, "npm install", "npm test", "npm run readiness", "npm run novelty"] }, null, 2));
    return;
  }

  if (command === "mcp-import") {
    const namespace = takeOption(args, "--namespace");
    const version = takeOption(args, "--version");
    const effectsComplete = takeFlag(args, "--effects-complete");
    const serverCommand = args.shift() ?? usage();
    const connection = await connectStdioMcpCapabilities({ command: serverCommand, args, namespace, version, effectsComplete });
    try {
      console.log(JSON.stringify({
        server: { command: serverCommand, args },
        tools: connection.tools.map((tool) => tool.name),
        capabilities: connection.capabilities.map(inspectCapability)
      }, null, 2));
    } finally {
      connection.session.close();
    }
    return;
  }

  if (command === "probe") {
    const site = args.shift() ?? usage();
    if (args.length) usage();
    console.log(JSON.stringify(await probeCapabilitySite(site), null, 2));
    return;
  }

  if (command === "create") {
    const packageName = takeOption(args, "--name");
    const capabilityId = takeOption(args, "--id");
    const description = takeOption(args, "--description");
    const repository = takeOption(args, "--repo");
    const force = takeFlag(args, "--force");
    const directory = args.shift() ?? usage();
    if (args.length) usage();
    const result = await scaffoldCapabilityProject({ directory, packageName, capabilityId, description, repository, force });
    console.log(JSON.stringify({ ...result, next: [`cd ${result.directory}`, "npm install", "npm test", "npm run readiness", "npm run novelty"] }, null, 2));
    return;
  }

  if (command === "readiness") {
    const packageJsonPath = args.shift() ?? "package.json";
    if (args.length) usage();
    const report = await assessProjectReadiness(packageJsonPath);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  if (command === "novelty") {
    const packageJsonPath = takeOption(args, "--package") ?? "package.json";
    const indexes = liveIndexes(args);
    const query = args.shift() ?? usage();
    if (args.length) usage();
    const proposed = await localManifest(query, packageJsonPath);
    const network = await fetchCapabilityNetwork(indexes);
    const existing = network.index.packages.flatMap((pkg) => pkg.capabilities.map((entry) => entry.manifest));
    console.log(JSON.stringify({ proposed: { id: proposed.id, version: proposed.version }, sources: network.sources, ...assessCapabilityNovelty(proposed, existing) }, null, 2));
    return;
  }

  if (command === "registry-entry") {
    const output = takeOption(args, "--out");
    const packageJsonPath = args.shift() ?? "package.json";
    if (args.length) usage();
    const record = await indexPackageRecord(packageJsonPath, "npm");
    const text = `${JSON.stringify(record, null, 2)}\n`;
    if (output) {
      await writeFile(resolve(output), text, "utf8");
      console.log(JSON.stringify({ output: resolve(output), package: `${record.name}@${record.version}`, capabilities: record.capabilities.length }, null, 2));
    } else console.log(text.trimEnd());
    return;
  }

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
    const records = await Promise.all(packages.map((path) => indexPackageRecord(path)));
    const index = createCapabilityIndex(records);
    await writeFile(resolve(outputPath), `${JSON.stringify(index, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ output: resolve(outputPath), packages: records.length, capabilities: records.reduce((sum, pkg) => sum + pkg.capabilities.length, 0) }, null, 2));
    return;
  }
  if (command === "openapi") {
    const [source, namespace] = args;
    if (!source) usage();
    const document = await readOpenApiSource(source);
    const capabilities = capabilitiesFromOpenApi(document as Record<string, unknown>, { namespace });
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
