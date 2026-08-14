import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CapabilityContext, CapabilityEffect, CapabilityManifest, CapabilityPlan, CapabilityReceipt } from "./types.js";

export type NodeCapabilityAction = "execute" | "plan" | "verify" | "rollback";

export type NodePermissionSandboxOptions = {
  effects?: readonly CapabilityEffect[];
  allowRead?: readonly string[];
  allowWrite?: readonly string[];
  environment?: Readonly<Record<string, string>>;
  requireNetworkIsolation?: boolean;
  timeoutMs?: number;
  context?: CapabilityContext;
};

export type NodeLifecycleEnvelope = {
  action: NodeCapabilityAction;
  input?: unknown;
  output?: unknown;
  manifest: Readonly<CapabilityManifest>;
  plan?: Readonly<CapabilityPlan>;
  receipt?: CapabilityReceipt;
};

const CHILD_SOURCE = String.raw`
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
const mod = await import(process.argv[1]);
const cap = mod.default ?? mod.capability;
if (!cap || typeof cap.execute !== 'function') throw new Error('Module does not export a capability');
const manifest = envelope.manifest ?? cap.manifest;
const plan = envelope.plan;
let result;
let hasResult = true;
if (envelope.action === 'execute') {
  result = await cap.execute(envelope.input, { manifest, plan });
} else if (envelope.action === 'plan') {
  result = typeof cap.plan === 'function' ? await cap.plan(envelope.input) : {};
} else if (envelope.action === 'verify') {
  if (typeof cap.verify === 'function') result = await cap.verify(envelope.output, { manifest, plan });
  else hasResult = false;
} else if (envelope.action === 'rollback') {
  if (typeof cap.rollback !== 'function') throw new Error('Capability does not export rollback()');
  result = await cap.rollback({ manifest, plan, input: envelope.input, output: envelope.output, receipt: envelope.receipt });
} else {
  throw new Error('Unknown capability action');
}
process.stdout.write(JSON.stringify({ ok: true, hasResult, result }));
`;

function majorNodeVersion(): number { return Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10); }

export async function runNodeCapabilityLifecycle(modulePath: string, envelope: NodeLifecycleEnvelope, options: NodePermissionSandboxOptions = {}): Promise<{ hasResult: boolean; result: unknown }> {
  const absolute = resolve(modulePath);
  const moduleUrl = pathToFileURL(absolute).href;
  const effects = options.effects ?? [];
  const major = majorNodeVersion();
  if (options.requireNetworkIsolation && major < 25 && !effects.includes("network.connect")) throw new Error("Strict network isolation requires Node 25+ or a stronger executor such as Docker");
  const args = ["--permission"];
  const readPaths = new Set([dirname(absolute), ...(options.allowRead ?? [])].map((path) => resolve(path)));
  for (const path of readPaths) args.push(`--allow-fs-read=${path}`);
  if (effects.includes("filesystem.write")) for (const path of options.allowWrite ?? []) args.push(`--allow-fs-write=${resolve(path)}`);
  if (effects.includes("process.spawn")) args.push("--allow-child-process");
  if (major >= 25 && effects.includes("network.connect")) args.push("--allow-net");
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
      try {
        const parsed = JSON.parse(stdout) as { hasResult: boolean; result: unknown };
        resolvePromise(parsed);
      } catch (error) { reject(new Error(`Invalid sandbox output: ${stdout}`, { cause: error })); }
    });
    child.stdin.end(JSON.stringify(envelope));
  });
}

export async function runInNodePermissionSandbox(modulePath: string, input: unknown, options: NodePermissionSandboxOptions = {}): Promise<unknown> {
  const manifest = options.context?.manifest ?? ({ specVersion: "0.1", id: "sandbox/module", version: "0.0.0", name: "sandbox", description: "sandbox", effects: options.effects ?? [] } as const);
  const response = await runNodeCapabilityLifecycle(modulePath, { action: "execute", input, manifest, ...(options.context?.plan ? { plan: options.context.plan } : {}) }, options);
  return response.result;
}
