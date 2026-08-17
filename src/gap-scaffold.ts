import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scaffoldCapabilityProject, type ScaffoldResult } from "./scaffold.js";
import type { CapabilityGap } from "./metabolism.js";

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "missing-ability";
}

export type GapScaffoldResult = ScaffoldResult & {
  gap: CapabilityGap;
  gapFile: string;
};

/**
 * Materialize an unresolved Capability gap as a normal Capability project.
 * This does not pretend to implement the missing ability. It gives a coding
 * agent or developer an executable project shell plus the exact unresolved
 * requirement and evidence that produced it.
 */
export async function scaffoldCapabilityGapProject(
  gap: CapabilityGap,
  options: {
    directory: string;
    packageName?: string;
    capabilityId?: string;
    repository?: string;
    force?: boolean;
  }
): Promise<GapScaffoldResult> {
  if (gap.status !== "unresolved") throw new TypeError("Only unresolved Capability gaps can be scaffolded");
  const stem = slug(gap.intent);
  const result = await scaffoldCapabilityProject({
    directory: options.directory,
    packageName: options.packageName ?? `cap-${stem}`,
    capabilityId: options.capabilityId ?? `generated/${stem}`,
    description: `Close the Capability gap: ${gap.intent}`,
    repository: options.repository,
    force: options.force
  });
  const gapFile = join(result.directory, "capability-gap.json");
  await writeFile(gapFile, `${JSON.stringify(gap, null, 2)}\n`, "utf8");

  const packagePath = join(result.directory, "package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8")) as Record<string, any>;
  pkg.files = [...new Set([...(Array.isArray(pkg.files) ? pkg.files : []), "capability-gap.json"])];
  pkg.capabilityGap = {
    source: "./capability-gap.json",
    gapVersion: gap.gapVersion,
    gapId: gap.id,
    intent: gap.intent
  };
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

  const readmePath = join(result.directory, "README.md");
  const readme = await readFile(readmePath, "utf8");
  const gapSection = `\n## Why this project exists\n\nThis project was generated from an unresolved Capability gap. The machine-readable requirement is preserved in \`capability-gap.json\`. Do not weaken its requested outcome or silently expand its authority ceiling just to make an implementation pass.\n\n**Intent:** ${gap.intent}\n\n**Authority ceiling:** ${gap.required.effectsCeiling.length ? gap.required.effectsCeiling.map((effect) => `\`${effect}\``).join(", ") : "no effects requested"}\n\n**Verification requirements:**\n${gap.required.verification.map((item) => `- ${item}`).join("\n")}\n`;
  await writeFile(readmePath, `${readme.trimEnd()}\n${gapSection}`, "utf8");

  return {
    ...result,
    files: [...new Set([...result.files, "capability-gap.json"])].sort(),
    gap,
    gapFile
  };
}
