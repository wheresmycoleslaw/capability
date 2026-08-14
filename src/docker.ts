import { spawn } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Capability,
  CapabilityContext,
  CapabilityEffect,
  CapabilityPlanDetails,
  CapabilityVerification,
  RollbackContext
} from "./types.js";
import { getProvenance } from "./provenance.js";
import type { CapabilityExecutor } from "./executor.js";
import { NodePermissionExecutor } from "./executor.js";

const CHILD_SOURCE = String.raw`
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
const mod = await import(process.argv[1]);
const cap = mod.default ?? mod.capability;
if (!cap || typeof cap.execute !== 'function') throw new Error('Module does not export a capability');
let result;
let hasResult = true;
if (envelope.action === 'execute') {
  result = await cap.execute(envelope.input, { manifest: envelope.manifest, plan: envelope.plan });
} else if (envelope.action === 'plan') {
  result = typeof cap.plan === 'function' ? await cap.plan(envelope.input) : {};
} else if (envelope.action === 'verify') {
  if (typeof cap.verify === 'function') result = await cap.verify(envelope.output, { manifest: envelope.manifest, plan: envelope.plan });
  else hasResult = false;
} else if (envelope.action === 'rollback') {
  if (typeof cap.rollback !== 'function') throw new Error('Capability does not export rollback()');
  result = await cap.rollback({ manifest: envelope.manifest, plan: envelope.plan, input: envelope.input, output: envelope.output, receipt: envelope.receipt });
} else throw new Error('Unknown capability action');
process.stdout.write(JSON.stringify({ ok: true, hasResult, result }));
`;

export type DockerMount = { source: string; target: string; readOnly?: boolean };
export type DockerExecutorOptions = {
  dockerCommand?: string;
  image?: string;
  timeoutMs?: number;
  memory?: string;
  cpus?: number;
  pidsLimit?: number;
  environment?: Readonly<Record<string, string>>;
  mounts?: readonly DockerMount[];
  network?: "auto" | "none" | "bridge";
};

type DockerLifecycleEnvelope = {
  action: "execute" | "plan" | "verify" | "rollback";
  input?: unknown;
  output?: unknown;
  receipt?: unknown;
  manifest: unknown;
  plan?: unknown;
};

function runDocker(command: string, args: readonly string[], input: string | undefined, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Docker execution timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(stderr || stdout || `docker exited with ${code}`));
    });
    child.stdin.end(input);
  });
}

export async function isDockerAvailable(command = "docker", timeoutMs = 5_000): Promise<boolean> {
  try { await runDocker(command, ["info", "--format", "{{.ServerVersion}}"], undefined, timeoutMs); return true; }
  catch { return false; }
}

export class DockerExecutor implements CapabilityExecutor {
  constructor(private readonly options: DockerExecutorOptions = {}) {}

  private source(capability: Capability): { root: string; module: string } {
    const provenance = getProvenance(capability);
    if (!provenance?.source) throw new Error(`DockerExecutor requires source provenance for ${capability.manifest.id}`);
    const hostModule = provenance.source.startsWith("file:") ? fileURLToPath(provenance.source) : provenance.source;
    const root = provenance.installRoot ?? provenance.packageRoot;
    if (!root) throw new Error(`DockerExecutor requires package/install root provenance for ${capability.manifest.id}`);
    const absoluteRoot = resolve(root);
    const absoluteModule = resolve(hostModule);
    const rel = relative(absoluteRoot, absoluteModule);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Capability module is outside the isolated install root");
    return { root: absoluteRoot, module: `/workspace/${rel.split(sep).join("/")}` };
  }

  private async lifecycle(capability: Capability, envelope: DockerLifecycleEnvelope, effects: readonly CapabilityEffect[]): Promise<{ hasResult: boolean; result: unknown }> {
    const source = this.source(capability);
    const command = this.options.dockerCommand ?? "docker";
    const requestedNetwork = this.options.network ?? "auto";
    const network = requestedNetwork === "auto" ? (effects.includes("network.connect") ? "bridge" : "none") : requestedNetwork;
    if (network !== "none" && !effects.includes("network.connect")) throw new Error("Docker network access cannot be granted to a capability that did not declare network.connect");
    const args = [
      "run", "--rm", "-i",
      `--network=${network}`,
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges:true",
      `--pids-limit=${this.options.pidsLimit ?? 64}`,
      `--memory=${this.options.memory ?? "256m"}`,
      `--cpus=${this.options.cpus ?? 1}`,
      "--user=65534:65534",
      "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=64m",
      "-v", `${source.root}:/workspace:ro`
    ];
    for (const mount of this.options.mounts ?? []) {
      const mode = mount.readOnly === false ? "rw" : "ro";
      if (mode === "rw" && !effects.includes("filesystem.write")) throw new Error("Writable Docker mounts require filesystem.write");
      args.push("-v", `${resolve(mount.source)}:${mount.target}:${mode}`);
    }
    for (const [name, value] of Object.entries(this.options.environment ?? {})) args.push("-e", `${name}=${value}`);
    args.push(this.options.image ?? "node:24-alpine", "node", "--input-type=module", "--eval", CHILD_SOURCE, source.module);
    const { stdout } = await runDocker(command, args, JSON.stringify(envelope), this.options.timeoutMs ?? 60_000);
    try { return JSON.parse(stdout) as { hasResult: boolean; result: unknown }; }
    catch (error) { throw new Error(`Invalid Docker executor output: ${stdout}`, { cause: error }); }
  }

  async execute(capability: Capability, input: unknown, context: CapabilityContext): Promise<unknown> {
    return (await this.lifecycle(capability, { action: "execute", input, manifest: context.manifest, plan: context.plan }, context.plan.effects)).result;
  }
  async plan(capability: Capability, input: unknown): Promise<CapabilityPlanDetails> {
    return (await this.lifecycle(capability, { action: "plan", input, manifest: capability.manifest }, capability.manifest.effects ?? [])).result as CapabilityPlanDetails;
  }
  async verify(capability: Capability, output: unknown, context: CapabilityContext): Promise<boolean | CapabilityVerification | undefined> {
    const response = await this.lifecycle(capability, { action: "verify", output, manifest: context.manifest, plan: context.plan }, context.plan.effects);
    return response.hasResult ? response.result as boolean | CapabilityVerification : undefined;
  }
  async rollback(capability: Capability, context: RollbackContext<unknown, unknown>): Promise<unknown> {
    return (await this.lifecycle(capability, {
      action: "rollback", input: context.input, output: context.output, receipt: context.receipt,
      manifest: context.manifest, plan: context.plan
    }, context.plan.effects)).result;
  }
}

export type AutoIsolatedExecutorOptions = {
  docker?: DockerExecutorOptions;
  node?: ConstructorParameters<typeof NodePermissionExecutor>[0];
  preferDocker?: boolean;
};

export class AutoIsolatedExecutor implements CapabilityExecutor {
  private dockerAvailable?: Promise<boolean>;
  private readonly docker: DockerExecutor;
  private readonly node: NodePermissionExecutor;
  constructor(private readonly options: AutoIsolatedExecutorOptions = {}) {
    this.docker = new DockerExecutor(options.docker);
    this.node = new NodePermissionExecutor(options.node ?? (() => ({ requireNetworkIsolation: true })));
  }
  private async target(): Promise<CapabilityExecutor> {
    if (this.options.preferDocker !== false) {
      this.dockerAvailable ??= isDockerAvailable(this.options.docker?.dockerCommand);
      if (await this.dockerAvailable) return this.docker;
    }
    return this.node;
  }
  async execute(capability: Capability, input: unknown, context: CapabilityContext) { return (await this.target()).execute(capability, input, context); }
  async plan(capability: Capability, input: unknown) { const target = await this.target(); return target.plan ? target.plan(capability, input) : {}; }
  async verify(capability: Capability, output: unknown, context: CapabilityContext) { const target = await this.target(); return target.verify ? target.verify(capability, output, context) : undefined; }
  async rollback(capability: Capability, context: RollbackContext<unknown, unknown>) {
    const target = await this.target();
    if (!target.rollback) throw new Error(`Executor cannot roll back ${capability.manifest.id}`);
    return target.rollback(capability, context);
  }
}
