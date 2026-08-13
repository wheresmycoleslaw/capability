import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { Capability } from "./types.js";
import type { PublicIndexResult } from "./public-index.js";
import { loadCapabilityFromPackage } from "./acquire.js";
import { requireCapabilityTrust, type CapabilityTrustAssessment, type CapabilityTrustPolicy } from "./trust.js";

export type InstalledCapabilityPackage = {
  packageJsonPath: string;
  root: string;
  packageName: string;
  packageVersion: string;
};

export interface CapabilityPackageInstaller {
  install(packageName: string, packageVersion: string): Promise<InstalledCapabilityPackage>;
}

export type NpmPackageInstallerOptions = {
  directory?: string;
  npmCommand?: string;
  registry?: string;
  timeoutMs?: number;
};

function packagePath(root: string, packageName: string): string {
  return join(root, "node_modules", ...packageName.split("/"), "package.json");
}

export class NpmPackageInstaller implements CapabilityPackageInstaller {
  constructor(private readonly options: NpmPackageInstallerOptions = {}) {}

  async install(packageName: string, packageVersion: string): Promise<InstalledCapabilityPackage> {
    const root = this.options.directory ? resolve(this.options.directory) : await mkdtemp(join(tmpdir(), "capability-npm-"));
    const npm = this.options.npmCommand ?? (process.platform === "win32" ? "npm.cmd" : "npm");
    const spec = `${packageName}@${packageVersion}`;
    const args = [
      "install",
      "--ignore-scripts",
      "--no-save",
      "--package-lock=false",
      "--audit=false",
      "--fund=false",
      "--prefix",
      root,
      spec
    ];
    if (this.options.registry) args.push("--registry", this.options.registry);
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(npm, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`npm install timed out for ${spec}`));
      }, this.options.timeoutMs ?? 120_000);
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolvePromise();
        else reject(new Error(stderr || `npm install exited with ${code}`));
      });
    });
    return { root, packageName, packageVersion, packageJsonPath: packagePath(root, packageName) };
  }
}

export async function acquireIndexedCapability(
  result: PublicIndexResult,
  options: { installer?: CapabilityPackageInstaller; trust?: CapabilityTrustPolicy } = {}
): Promise<{ capability: Capability; installed: InstalledCapabilityPackage; trust: CapabilityTrustAssessment }> {
  const installer = options.installer ?? new NpmPackageInstaller();
  const installed = await installer.install(result.package.name, result.package.version);
  const capability = await loadCapabilityFromPackage(installed.packageJsonPath, result.capability.manifest.id);
  const trust = requireCapabilityTrust(capability, options.trust ?? { requirePackage: true });
  return { capability, installed, trust };
}
