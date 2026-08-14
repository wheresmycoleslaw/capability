import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { Capability } from "./types.js";
import type { PublicIndexResult } from "./public-index.js";
import { inspectModuleBackedCapability, loadCapabilityFromPackage } from "./acquire.js";
import { attachProvenance, getProvenance } from "./provenance.js";
import { requireCapabilityTrust, type CapabilityTrustAssessment, type CapabilityTrustPolicy } from "./trust.js";
import { sha256 } from "./utils.js";

export type NpmPackageVerification = {
  registrySignatureVerified: boolean;
  provenanceVerified: boolean;
  provider: string;
  verifiedAt: string;
  attestation?: string;
};

export type InstalledCapabilityPackage = {
  packageJsonPath: string;
  root: string;
  packageName: string;
  packageVersion: string;
  packageIntegrity?: string;
  repository?: string;
  commit?: string;
  verification?: NpmPackageVerification;
};

export interface CapabilityPackageInstaller {
  install(packageName: string, packageVersion: string): Promise<InstalledCapabilityPackage>;
}

export type NpmPackageInstallerOptions = {
  directory?: string;
  npmCommand?: string;
  registry?: string;
  timeoutMs?: number;
  verifySignatures?: boolean;
};

type CommandResult = { stdout: string; stderr: string };
type NpmView = {
  name?: string;
  version?: string;
  gitHead?: string;
  repository?: string | { url?: string };
  dist?: { integrity?: string; signatures?: unknown[]; attestations?: unknown };
};

function packagePath(root: string, packageName: string): string { return join(root, "node_modules", ...packageName.split("/"), "package.json"); }
function repositoryUrl(value: NpmView["repository"]): string | undefined { return typeof value === "string" ? value : value?.url; }
function attestationReference(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.url === "string") return record.url;
    const provenance = record.provenance;
    if (provenance && typeof provenance === "object" && typeof (provenance as Record<string, unknown>).url === "string") return (provenance as Record<string, string>).url;
  }
  return "npm-provenance-attestation";
}

async function runCommand(command: string, args: readonly string[], timeoutMs: number): Promise<CommandResult> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} ${args.join(" ")} timed out`)); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(stderr || stdout || `${command} exited with ${code}`));
    });
  });
}

async function ensureInstallRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  const packageJson = join(root, "package.json");
  try { await access(packageJson); }
  catch { await writeFile(packageJson, JSON.stringify({ name: "capability-acquisition", private: true, version: "0.0.0" }), "utf8"); }
}

export class NpmPackageInstaller implements CapabilityPackageInstaller {
  constructor(private readonly options: NpmPackageInstallerOptions = {}) {}
  async install(packageName: string, packageVersion: string): Promise<InstalledCapabilityPackage> {
    const root = this.options.directory ? resolve(this.options.directory) : await mkdtemp(join(tmpdir(), "capability-npm-"));
    await ensureInstallRoot(root);
    const npm = this.options.npmCommand ?? (process.platform === "win32" ? "npm.cmd" : "npm");
    const spec = `${packageName}@${packageVersion}`;
    const timeout = this.options.timeoutMs ?? 120_000;
    const registryArgs = this.options.registry ? ["--registry", this.options.registry] : [];
    const viewResult = await runCommand(npm, ["view", spec, "--json", ...registryArgs], timeout);
    const view = JSON.parse(viewResult.stdout || "{}") as NpmView;
    if (view.name && view.name !== packageName) throw new Error(`npm resolved ${spec} to unexpected package ${view.name}`);
    if (view.version && view.version !== packageVersion) throw new Error(`npm resolved ${spec} to unexpected version ${view.version}`);
    await runCommand(npm, ["install", "--ignore-scripts", "--package-lock=true", "--audit=false", "--fund=false", "--prefix", root, spec, ...registryArgs], timeout);
    const packageJsonPath = packagePath(root, packageName);
    const installedJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { name?: string; version?: string };
    if (installedJson.name !== packageName || installedJson.version !== packageVersion) throw new Error(`Installed package identity mismatch: expected ${spec}, got ${installedJson.name}@${installedJson.version}`);
    let verification: NpmPackageVerification | undefined;
    if (this.options.verifySignatures) {
      await runCommand(npm, ["audit", "signatures", "--json", "--include-attestations", "--prefix", root, ...registryArgs], timeout);
      const hasRegistrySignature = Array.isArray(view.dist?.signatures) && view.dist.signatures.length > 0;
      const attestation = attestationReference(view.dist?.attestations);
      verification = {
        registrySignatureVerified: hasRegistrySignature,
        provenanceVerified: Boolean(attestation),
        provider: "npm audit signatures",
        verifiedAt: new Date().toISOString(),
        ...(attestation ? { attestation } : {})
      };
      if (!hasRegistrySignature) throw new Error(`npm registry signature missing for ${spec}`);
    }
    return {
      root, packageName, packageVersion, packageJsonPath,
      ...(view.dist?.integrity ? { packageIntegrity: view.dist.integrity } : {}),
      ...(repositoryUrl(view.repository) ? { repository: repositoryUrl(view.repository) } : {}),
      ...(view.gitHead ? { commit: view.gitHead } : {}),
      ...(verification ? { verification } : {})
    };
  }
}

export class VerifiedNpmPackageInstaller extends NpmPackageInstaller {
  constructor(options: Omit<NpmPackageInstallerOptions, "verifySignatures"> = {}) { super({ ...options, verifySignatures: true }); }
}

export async function acquireIndexedCapability(
  result: PublicIndexResult,
  options: { installer?: CapabilityPackageInstaller; trust?: CapabilityTrustPolicy; loadCode?: boolean } = {}
): Promise<{ capability: Capability; installed: InstalledCapabilityPackage; trust: CapabilityTrustAssessment }> {
  const installer = options.installer ?? new NpmPackageInstaller();
  const installed = await installer.install(result.package.name, result.package.version);
  if (installed.packageName !== result.package.name || installed.packageVersion !== result.package.version) throw new Error("Installer returned a package different from the selected index entry");
  if (result.package.integrity && installed.packageIntegrity !== result.package.integrity) throw new Error(`Package integrity mismatch for ${result.package.name}@${result.package.version}`);
  const capability = options.loadCode === false
    ? await inspectModuleBackedCapability(installed.packageJsonPath, result.capability.manifest.id)
    : await loadCapabilityFromPackage(installed.packageJsonPath, result.capability.manifest.id);
  if (sha256(capability.manifest) !== sha256(result.capability.manifest)) throw new Error(`Installed manifest does not match public index for ${result.capability.manifest.id}`);
  const observed = getProvenance(capability) ?? {};
  if (result.capability.integrity && observed.integrity && result.capability.integrity !== observed.integrity) throw new Error(`Module integrity mismatch for ${result.capability.manifest.id}`);
  attachProvenance(capability, {
    ...observed,
    packageRoot: dirname(installed.packageJsonPath),
    installRoot: installed.root,
    ...(installed.packageIntegrity ? { packageIntegrity: installed.packageIntegrity } : {}),
    ...(installed.repository ? { repository: installed.repository } : {}),
    ...(installed.commit ? { commit: installed.commit } : {}),
    ...(installed.verification?.attestation ? { attestation: installed.verification.attestation } : {}),
    ...(installed.verification ? {
      registrySignatureVerified: installed.verification.registrySignatureVerified,
      provenanceVerified: installed.verification.provenanceVerified,
      verificationProvider: installed.verification.provider,
      verifiedAt: installed.verification.verifiedAt
    } : {})
  });
  const trust = requireCapabilityTrust(capability, options.trust ?? { requirePackage: true });
  return { capability, installed, trust };
}
