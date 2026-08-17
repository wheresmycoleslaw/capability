import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { validateManifest } from "./manifest.js";
import type { CapabilityEffect, CapabilityManifest, JsonValue } from "./types.js";

export const CAPABILITY_PYPI_BINDER_VERSION = "0.2" as const;

export type PyPiFile = {
  filename: string;
  url: string;
  packagetype: string;
  python_version?: string;
  requires_python?: string;
  digests?: { sha256?: string };
  yanked?: boolean;
  size?: number;
};

export type PyPiInspection = {
  name: string;
  version: string;
  summary?: string;
  requiresPython?: string;
  projectUrls: Record<string, string>;
  wheel: { filename: string; url: string; sha256: string; size?: number };
  vulnerabilities: unknown[];
};

export type PythonCandidate = {
  module: string;
  symbol: string;
  kind: "function" | "console-script";
  score: number;
  evidence: string[];
};

export type PythonMiningReport = {
  artifact: PyPiInspection;
  candidates: PythonCandidate[];
  filesAnalyzed: number;
  notes: string[];
};

export type PythonForge = {
  substrate: "pypi";
  artifact: PyPiInspection;
  candidate: PythonCandidate;
  directory: string;
  wheelPath: string;
  capabilityId: string;
  manifest: CapabilityManifest;
  authority: { complete: false; effects: CapabilityEffect[] };
};

export type PythonExecutionReceipt = {
  substrate: "pypi";
  binderVersion: typeof CAPABILITY_PYPI_BINDER_VERSION;
  package: string;
  version: string;
  wheel: string;
  artifactSha256: string;
  artifactVerified: true;
  baseImage: string;
  baseImageDigest: string;
  module: string;
  symbol: string;
  kind: PythonCandidate["kind"];
  isolation: "docker";
  network: "none";
  dependencyPolicy: "no-deps";
  status: "succeeded" | "failed";
  result?: JsonValue;
  stderr?: string;
  startedAt: string;
  finishedAt: string;
};

type RunResult = { stdout: string; stderr: string; code: number };

function run(command: string, args: readonly string[], options: { input?: string; cwd?: string; timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${options.timeoutMs ?? 120_000}ms`));
    }, options.timeoutMs ?? 120_000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code: code ?? -1 });
    });
    child.stdin.end(options.input);
  });
}

async function runPython(script: string, args: readonly string[], timeoutMs = 30_000): Promise<RunResult> {
  const commands = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
  let lastError: unknown;
  for (const command of commands) {
    try {
      const prefix = command === "py" ? ["-3", "-c", script] : ["-c", script];
      return await run(command, [...prefix, ...args], { timeoutMs });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("Python 3 is required to mine PyPI wheel source", { cause: lastError });
}

function universalWheel(file: PyPiFile): boolean {
  return /-(?:py3|py2\.py3)-none-any\.whl$/i.test(file.filename);
}

export async function inspectPyPiPackage(name: string, version?: string, fetchImpl: typeof fetch = fetch): Promise<PyPiInspection> {
  const endpoint = `https://pypi.org/pypi/${encodeURIComponent(name)}${version ? `/${encodeURIComponent(version)}` : ""}/json`;
  const response = await fetchImpl(endpoint, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`PyPI inspection failed: HTTP ${response.status}`);
  const data = await response.json() as Record<string, any>;
  const info = data.info ?? {};
  const urls = (Array.isArray(data.urls) ? data.urls : []) as PyPiFile[];
  const wheels = urls.filter((file) => file.packagetype === "bdist_wheel" && !file.yanked && file.digests?.sha256);
  const wheel = wheels.find(universalWheel);
  if (!wheel?.digests?.sha256) {
    throw new Error(`${info.name ?? name}@${info.version ?? version ?? "latest"} has no non-yanked universal Python wheel with SHA256; the automatic binder refuses platform-specific wheel selection until that platform is explicitly bound`);
  }
  const projectUrls: Record<string, string> = {};
  if (info.project_urls && typeof info.project_urls === "object") {
    for (const [key, value] of Object.entries(info.project_urls)) if (typeof value === "string") projectUrls[key] = value;
  }
  return {
    name: String(info.name ?? name),
    version: String(info.version ?? version ?? ""),
    ...(typeof info.summary === "string" ? { summary: info.summary } : {}),
    ...(typeof info.requires_python === "string" ? { requiresPython: info.requires_python } : {}),
    projectUrls,
    wheel: {
      filename: wheel.filename,
      url: wheel.url,
      sha256: wheel.digests.sha256,
      ...(typeof wheel.size === "number" ? { size: wheel.size } : {})
    },
    vulnerabilities: Array.isArray(data.vulnerabilities) ? data.vulnerabilities : []
  };
}

export async function downloadVerifiedPyPiWheel(artifact: PyPiInspection, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const response = await fetchImpl(artifact.wheel.url);
  if (!response.ok) throw new Error(`PyPI wheel download failed: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== artifact.wheel.sha256) throw new Error(`PyPI wheel SHA256 mismatch: expected ${artifact.wheel.sha256}, got ${actual}`);
  return bytes;
}

const WHEEL_MINER = [
  "import ast, json, re, sys, zipfile",
  "wheel, query, max_files = sys.argv[1], sys.argv[2].lower(), int(sys.argv[3])",
  "tokens=[x for x in re.split(r'[^a-z0-9]+', query) if len(x)>1]",
  "out=[]; analyzed=0; scripts=[]",
  "with zipfile.ZipFile(wheel) as z:",
  "  for path in z.namelist():",
  "    if path.endswith('.dist-info/entry_points.txt'):",
  "      text=z.read(path).decode('utf-8','replace'); section=''",
  "      for line in text.splitlines():",
  "        line=line.strip()",
  "        if line.startswith('['): section=line.strip('[]')",
  "        elif section=='console_scripts' and '=' in line:",
  "          _,right=line.split('=',1); target=right.strip().split(':',1)",
  "          scripts.append({'module':target[0].strip(),'symbol':target[1].strip() if len(target)>1 else '__main__','kind':'console-script','score':1.0,'evidence':[path+' console_scripts']})",
  "  for path in z.namelist():",
  "    if analyzed>=max_files: break",
  "    if not path.endswith('.py') or '.dist-info/' in path or '/tests/' in path or path.startswith('tests/'): continue",
  "    try: text=z.read(path).decode('utf-8'); tree=ast.parse(text)",
  "    except Exception: continue",
  "    analyzed+=1; module=path[:-3].replace('/','.')",
  "    if module.endswith('.__init__'): module=module[:-9]",
  "    for node in tree.body:",
  "      if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and not node.name.startswith('_'):",
  "        doc=ast.get_docstring(node) or ''; hay=(node.name+' '+doc+' '+module).lower(); matched=[t for t in tokens if t in hay]",
  "        score=(len(matched)/len(tokens) if tokens else 0.5) + (0.2 if doc else 0)",
  "        out.append({'module':module,'symbol':node.name,'kind':'function','score':round(score,4),'evidence':[f'{path}:{getattr(node,\"lineno\",1)}',doc[:240]]})",
  "out.extend(scripts)",
  "out.sort(key=lambda x:(-x['score'],x['module'],x['symbol']))",
  "print(json.dumps({'candidates':out[:100],'filesAnalyzed':analyzed}))"
].join("\n");

export async function minePyPiArtifact(name: string, options: { version?: string; query?: string; fetch?: typeof fetch; maxFiles?: number } = {}): Promise<PythonMiningReport> {
  const fetchImpl = options.fetch ?? fetch;
  const artifact = await inspectPyPiPackage(name, options.version, fetchImpl);
  const bytes = await downloadVerifiedPyPiWheel(artifact, fetchImpl);
  const temp = await mkdtemp(join(tmpdir(), "cap-pypi-mine-"));
  const wheelPath = join(temp, artifact.wheel.filename);
  await writeFile(wheelPath, bytes);
  const result = await runPython(WHEEL_MINER, [wheelPath, options.query ?? "", String(options.maxFiles ?? 120)]);
  if (result.code !== 0) throw new Error(result.stderr || "Python wheel AST mining failed");
  const parsed = JSON.parse(result.stdout) as { candidates: PythonCandidate[]; filesAnalyzed: number };
  return {
    artifact,
    candidates: parsed.candidates,
    filesAnalyzed: parsed.filesAnalyzed,
    notes: [
      "The exact wheel bytes were SHA256-verified before analysis.",
      "Mining parses source and entry-point metadata directly from the wheel without importing the package.",
      "Automatic binding is restricted to universal wheels; platform-specific wheels require a platform binder.",
      "Authority remains incomplete because source evidence cannot prove all transitive runtime effects."
    ]
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "python-ability";
}

export async function forgePyPiAbility(name: string, options: { version?: string; query?: string; module?: string; symbol?: string; directory?: string; fetch?: typeof fetch } = {}): Promise<PythonForge> {
  const fetchImpl = options.fetch ?? fetch;
  const report = await minePyPiArtifact(name, options);
  let candidate = report.candidates.find((entry) => (!options.module || entry.module === options.module) && (!options.symbol || entry.symbol === options.symbol));
  candidate ??= report.candidates[0];
  if (!candidate) throw new Error(`No public Python operation discovered in ${name}`);
  const directory = resolve(options.directory ?? await mkdtemp(join(tmpdir(), "cap-python-forge-")));
  await mkdir(directory, { recursive: true });
  const bytes = await downloadVerifiedPyPiWheel(report.artifact, fetchImpl);
  const wheelPath = join(directory, report.artifact.wheel.filename);
  await writeFile(wheelPath, bytes);
  const capabilityId = `forged/python/${slug(report.artifact.name)}/${slug(candidate.symbol)}`;
  const manifest: CapabilityManifest = {
    specVersion: "0.1",
    id: capabilityId,
    version: "1.0.0",
    name: `${candidate.symbol} — Python forged`,
    description: `Artifact-bound Python ability for ${candidate.module}:${candidate.symbol} from ${report.artifact.name}@${report.artifact.version}.`,
    input: { type: "object", properties: { args: { type: "array", items: {} }, kwargs: { type: "object" } }, required: ["args"] },
    output: { type: "object", properties: { result: {} }, required: ["result"] },
    effects: ["process.spawn", "custom:external.opaque-effects"],
    behavior: { deterministic: false, idempotent: false, reversible: false },
    tags: ["forged", "python", "pypi", "artifact-bound"],
    metadata: {
      forged: true,
      substrate: "pypi",
      binderVersion: CAPABILITY_PYPI_BINDER_VERSION,
      package: report.artifact.name,
      packageVersion: report.artifact.version,
      wheel: report.artifact.wheel.filename,
      artifactSha256: report.artifact.wheel.sha256,
      module: candidate.module,
      symbol: candidate.symbol,
      authorityComplete: false
    }
  };
  const issues = validateManifest(manifest);
  if (issues.length) throw new Error(`Generated Python manifest invalid: ${issues.join("; ")}`);
  await writeFile(join(directory, "capability.python.json"), `${JSON.stringify({
    binderVersion: CAPABILITY_PYPI_BINDER_VERSION,
    substrate: "pypi",
    artifact: report.artifact,
    candidate,
    manifest,
    authority: { complete: false, effects: manifest.effects ?? [] }
  }, null, 2)}\n`);
  return {
    substrate: "pypi",
    artifact: report.artifact,
    candidate,
    directory,
    wheelPath,
    capabilityId,
    manifest,
    authority: { complete: false, effects: [...(manifest.effects ?? [])] }
  };
}

async function pinDockerImage(reference: string, docker: string): Promise<string> {
  const pull = await run(docker, ["pull", reference], { timeoutMs: 180_000 });
  if (pull.code !== 0) throw new Error(pull.stderr || `docker pull failed for ${reference}`);
  const inspect = await run(docker, ["image", "inspect", reference, "--format", "{{json .RepoDigests}}"], { timeoutMs: 30_000 });
  if (inspect.code !== 0) throw new Error(inspect.stderr || `docker image inspect failed for ${reference}`);
  const digests = JSON.parse(inspect.stdout.trim() || "[]") as string[];
  const immutable = digests[0];
  if (!immutable) throw new Error(`Docker base image ${reference} has no immutable RepoDigest`);
  return immutable;
}

const PYTHON_RUNNER = [
  "import importlib, json, sys",
  "env=json.loads(sys.stdin.read() or '{}')",
  "mod=importlib.import_module(env['module'])",
  "fn=getattr(mod, env['symbol'])",
  "args=env.get('args') or []",
  "kwargs=env.get('kwargs') or {}",
  "if env.get('kind') == 'console-script':",
  "  sys.argv=[env['symbol'], *[str(x) for x in args]]",
  "  value=fn()",
  "else:",
  "  value=fn(*args, **kwargs)",
  "try:",
  "  print(json.dumps({'result': value}))",
  "except TypeError as exc:",
  "  raise RuntimeError('Python operation returned a non-JSON-serializable result; a typed binder is required') from exc"
].join("\n");

export async function executePyPiAbility(forged: PythonForge, input: { args?: unknown[]; kwargs?: Record<string, unknown> }, options: { approved?: boolean; dockerCommand?: string; timeoutMs?: number } = {}): Promise<PythonExecutionReceipt> {
  if (!options.approved) throw new Error("Python forged first execution requires explicit approval");
  const docker = options.dockerCommand ?? "docker";
  const wheelBytes = new Uint8Array(await readFile(forged.wheelPath));
  const actual = createHash("sha256").update(wheelBytes).digest("hex");
  if (actual !== forged.artifact.wheel.sha256) throw new Error(`Forged wheel changed after binding: expected ${forged.artifact.wheel.sha256}, got ${actual}`);

  const baseImage = "python:3.12-slim";
  const baseImageDigest = await pinDockerImage(baseImage, docker);
  const context = await mkdtemp(join(tmpdir(), "cap-python-image-"));
  const wheelName = basename(forged.wheelPath);
  await writeFile(join(context, wheelName), wheelBytes);
  await writeFile(join(context, "Dockerfile"), [
    `FROM ${baseImageDigest}`,
    `COPY ${wheelName} /tmp/${wheelName}`,
    `RUN python -m pip install --disable-pip-version-check --no-index --no-deps --no-cache-dir /tmp/${wheelName}`
  ].join("\n") + "\n");

  const buildTag = `cap-pypi-${slug(forged.artifact.name)}-${Date.now()}`;
  const build = await run(docker, ["build", "--network=none", "-t", buildTag, context], { timeoutMs: options.timeoutMs ?? 180_000 });
  if (build.code !== 0) throw new Error(build.stderr || "Exact-wheel Python Docker build failed");

  const startedAt = new Date().toISOString();
  const envelope = JSON.stringify({
    module: forged.candidate.module,
    symbol: forged.candidate.symbol,
    kind: forged.candidate.kind,
    args: input.args ?? [],
    kwargs: input.kwargs ?? {}
  });
  const execution = await run(docker, [
    "run", "--rm", "-i",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--pids-limit=64",
    "--memory=512m",
    "--cpus=1",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=64m",
    buildTag,
    "python", "-c", PYTHON_RUNNER
  ], { input: envelope, timeoutMs: options.timeoutMs ?? 120_000 });
  await run(docker, ["image", "rm", "-f", buildTag], { timeoutMs: 30_000 });

  const base = {
    substrate: "pypi" as const,
    binderVersion: CAPABILITY_PYPI_BINDER_VERSION,
    package: forged.artifact.name,
    version: forged.artifact.version,
    wheel: forged.artifact.wheel.filename,
    artifactSha256: forged.artifact.wheel.sha256,
    artifactVerified: true as const,
    baseImage,
    baseImageDigest,
    module: forged.candidate.module,
    symbol: forged.candidate.symbol,
    kind: forged.candidate.kind,
    isolation: "docker" as const,
    network: "none" as const,
    dependencyPolicy: "no-deps" as const,
    startedAt,
    finishedAt: new Date().toISOString()
  };
  if (execution.code !== 0) return { ...base, status: "failed", stderr: execution.stderr || execution.stdout };
  const parsed = JSON.parse(execution.stdout) as { result: JsonValue };
  return { ...base, status: "succeeded", result: parsed.result };
}
