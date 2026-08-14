import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateCapabilityIndex, assessCapabilityNovelty } from "../dist/index.js";

const execFileAsync = promisify(execFile);
const index = JSON.parse(await readFile(new URL("../registry/index.json", import.meta.url), "utf8"));
const localPackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const structuralIssues = validateCapabilityIndex(index);
if (structuralIssues.length) throw new Error(`Registry structure invalid:\n- ${structuralIssues.join("\n- ")}`);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function equal(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
function npmCommand() { return process.platform === "win32" ? "npm.cmd" : "npm"; }

const exactCapabilityKeys = new Set();
const manifests = [];
for (const pkg of index.packages) {
  for (const capability of pkg.capabilities) {
    const key = `${capability.manifest.id}@${capability.manifest.version}`;
    if (exactCapabilityKeys.has(key)) throw new Error(`Duplicate capability contract in registry: ${key}`);
    exactCapabilityKeys.add(key);
    manifests.push(capability.manifest);
  }
}

let npmArtifactsVerified = 0;
let localReleaseCandidatesVerified = 0;
for (const pkg of index.packages) {
  if (pkg.source !== "npm") continue;
  const isLocalReleaseCandidate = pkg.name === localPackage.name && pkg.version === localPackage.version;
  let metadata;
  if (isLocalReleaseCandidate) {
    metadata = localPackage;
    localReleaseCandidatesVerified += 1;
  } else {
    try {
      const { stdout } = await execFileAsync(npmCommand(), ["view", `${pkg.name}@${pkg.version}`, "--json"], { maxBuffer: 8 * 1024 * 1024 });
      metadata = JSON.parse(stdout);
      npmArtifactsVerified += 1;
    } catch (error) {
      throw new Error(`Unable to resolve ${pkg.name}@${pkg.version} from npm`, { cause: error });
    }
    if (metadata.name !== pkg.name || metadata.version !== pkg.version) throw new Error(`npm identity mismatch for ${pkg.name}@${pkg.version}`);
    if (!metadata.dist?.integrity) throw new Error(`${pkg.name}@${pkg.version} has no npm dist integrity`);
  }
  if (!metadata.capability?.exports) throw new Error(`${pkg.name}@${pkg.version} does not publish package.json capability metadata`);
  for (const indexed of pkg.capabilities) {
    const remote = metadata.capability.exports[indexed.manifest.id];
    if (!remote || typeof remote === "string") throw new Error(`${pkg.name}@${pkg.version} does not expose an inert descriptor for ${indexed.manifest.id}`);
    if (remote.module !== indexed.module) throw new Error(`${pkg.name}@${pkg.version}:${indexed.manifest.id} module differs between package metadata and registry`);
    if (!equal(remote.manifest, indexed.manifest)) throw new Error(`${pkg.name}@${pkg.version}:${indexed.manifest.id} manifest differs between package metadata and registry`);
  }
}

const noveltyWarnings = [];
for (const proposed of manifests) {
  const existing = manifests.filter((manifest) => manifest.id !== proposed.id);
  if (!existing.length) continue;
  const assessment = assessCapabilityNovelty(proposed, existing);
  if (assessment.classification === "functional-twin") {
    const nearest = assessment.nearest[0];
    throw new Error(`Registry functional twin rejected: ${proposed.id} is too similar to ${nearest?.id ?? "an existing capability"} (${Math.round((nearest?.similarity ?? 0) * 100)}% similarity). Improve the existing capability or create materially new behavior.`);
  }
  if (assessment.classification === "incremental") noveltyWarnings.push(`${proposed.id}: incremental relative to ${assessment.nearest[0]?.id ?? "existing registry"}`);
}

console.log(JSON.stringify({
  ok: true,
  packages: index.packages.length,
  capabilities: manifests.length,
  npmArtifactsVerified,
  localReleaseCandidatesVerified,
  noveltyWarnings
}, null, 2));
