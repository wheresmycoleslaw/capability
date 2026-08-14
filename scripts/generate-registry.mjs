import { readFile, writeFile } from "node:fs/promises";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function same(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const registryUrl = new URL("../registry/index.json", import.meta.url);
let current;
try { current = JSON.parse(await readFile(registryUrl, "utf8")); }
catch { current = { indexVersion: "0.1", generatedAt: new Date(0).toISOString(), packages: [], federates: [] }; }

if (!packageJson.capability?.exports) throw new Error("package.json capability.exports is required");
const repository = typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url;
const capabilities = Object.entries(packageJson.capability.exports).map(([id, entry]) => {
  if (typeof entry === "string") throw new Error(`Registry requires inert manifest metadata for ${id}`);
  if (entry.manifest?.id !== id) throw new Error(`Manifest id mismatch for ${id}`);
  return { manifest: entry.manifest, module: entry.module, ...(entry.integrity ? { integrity: entry.integrity } : {}) };
});
const expected = {
  name: packageJson.name,
  version: packageJson.version,
  source: "npm",
  ...(repository ? { repository: repository.replace(/^git\+/, "").replace(/\.git$/, "") } : {}),
  capabilities
};

const mode = process.argv[2] ?? "--check";
if (mode === "--check") {
  const found = current.packages?.find((entry) => entry.name === expected.name && entry.version === expected.version);
  if (!found) throw new Error(`registry/index.json does not contain ${expected.name}@${expected.version}; run npm run registry`);
  if (!same(found, expected)) throw new Error("registry/index.json package metadata differs from package.json; run npm run registry");
  console.log(`registry ok: ${expected.name}@${expected.version} (${capabilities.length} capabilities)`);
} else if (mode === "--write") {
  const packages = (current.packages ?? []).filter((entry) => entry.name !== expected.name);
  packages.push(expected);
  packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  const document = {
    indexVersion: "0.1",
    generatedAt: new Date().toISOString(),
    ...(current.metadata ? { metadata: current.metadata } : {}),
    ...(current.federates ? { federates: current.federates } : {}),
    packages
  };
  await writeFile(registryUrl, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  console.log(`registry updated: ${expected.name}@${expected.version} (${capabilities.length} capabilities)`);
} else {
  throw new Error(`Unknown mode: ${mode}`);
}
