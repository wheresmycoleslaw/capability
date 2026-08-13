import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CapabilityEffect } from "./types.js";

export type NodePermissionSandboxOptions = {
  effects?: readonly CapabilityEffect[];
  allowRead?: readonly string[];
  allowWrite?: readonly string[];
  environment?: Readonly<Record<string, string>>;
  requireNetworkIsolation?: boolean;
  timeoutMs?: number;
};

const CHILD_SOURCE = String.raw`
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
const mod = await import(process.argv[1]);
const cap = mod.default ?? mod.capability;
if (!cap || typeof cap.execute !== 'function') throw new Error('Module does not export a capability');
const manifest = cap.manifest ?? { id: 'sandbox/module', version: '0.0.0', name: 'sandbox', effects: [] };
const now = new Date().toISOString();
const plan = { planId: 'sandbox', capability: { id: manifest.id, version: manifest.version }, input, inputHash: 'sandbox', effects: manifest.effects ?? [], summary: 'sandbox execution', createdAt: now, fingerprint: 'sandbox' };
const output = await cap.execute(input, { manifest, plan });
process.stdout.write(JSON.stringify({ ok: true, output }));
`;

function majorNodeVersion(): number { return Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10); }

export async function runInNodePermissionSandbox(modulePath: string, input: unknown, options: NodePermissionSandboxOptions = {}): Promise<unknown> {
  const absolute = resolve(modulePath);
  const moduleUrl = pathToFileURL(absolute).href;
  const effects = options.effects ?? [];
  const major = majorNodeVersion();
  if (options.requireNetworkIsolation && major < 25 && !effects.includes("network.connect")) throw new Error("Strict network isolation requires Node 25+ (--allow-net)");
  const args = ["--permission"];
  const readPaths = new Set([dirname(absolute), ...(options.allowRead ?? [])].map((path) => resolve(path)));
  for (const path of readPaths) args.push(`--allow-fs-read=${path}`);
  if (effects.includes("filesystem.write")) for (const path of options.allowWrite ?? []) args.push(`--allow-fs-write=${resolve(path)}`);
  if (effects.includes("process.spawn")) args.push("--allow-child-process");
  if (major >= 25 && effects.includes("network.connect")) args.push("--allow-net=*");
  args.push("--input-type=module", "--eval", CHILD_SOURCE, moduleUrl);
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...(options.environment ?? {}) } });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Sandbox execution timed out")); }, options.timeoutMs ?? 30_000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr || `Sandbox exited with code ${code}`));
      try { resolvePromise((JSON.parse(stdout) as { output: unknown }).output); }
      catch (error) { reject(new Error(`Invalid sandbox output: ${stdout}`, { cause: error })); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
