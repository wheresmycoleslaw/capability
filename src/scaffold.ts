import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { validatePackageDeclaration, type PackageJsonWithCapabilities } from "./package.js";

const CAPABILITY_RUNTIME_VERSION = "^0.4.0";

type ScaffoldOptions = {
  directory: string;
  packageName?: string;
  capabilityId?: string;
  description?: string;
  repository?: string;
  force?: boolean;
};

export type ScaffoldResult = { directory: string; packageName: string; capabilityId: string; files: readonly string[] };
export type ReadinessCheck = { id: string; status: "pass" | "warn" | "fail"; message: string };
export type ProjectReadiness = { ok: boolean; score: number; checks: readonly ReadinessCheck[] };

function slug(value: string): string {
  const result = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return result || "my-capability";
}

function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
async function exists(path: string): Promise<boolean> { try { await access(path, constants.F_OK); return true; } catch { return false; } }

function sourceFor(id: string, name: string, description: string): string {
  return `import { defineCapability } from "@wheresmycoleslaw/capability";\n\ntype Input = { value: string };\ntype Output = { value: string };\n\nexport default defineCapability<Input, Output>({\n  manifest: {\n    specVersion: "0.1",\n    id: ${JSON.stringify(id)},\n    version: "1.0.0",\n    name: ${JSON.stringify(name)},\n    description: ${JSON.stringify(description)},\n    input: {\n      type: "object",\n      properties: { value: { type: "string" } },\n      required: ["value"]\n    },\n    output: {\n      type: "object",\n      properties: { value: { type: "string" } },\n      required: ["value"]\n    },\n    effects: [],\n    behavior: { deterministic: true, idempotent: true, reversible: false },\n    tags: ["starter"]\n  },\n  execute(input: Input) {\n    // Replace this with the new ability. Keep the manifest contract in sync with package.json.\n    return { value: input.value };\n  }\n});\n`;
}

function testFor(id: string): string {
  return `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport capability from "../dist/index.js";\n\ntest("package metadata and executable manifest cannot drift", async () => {\n  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));\n  assert.deepEqual(capability.manifest, pkg.capability.exports[${JSON.stringify(id)}].manifest);\n});\n\ntest("capability executes its starter contract", async () => {\n  assert.deepEqual(await capability.execute({ value: "hello" }, {}), { value: "hello" });\n});\n`;
}

function readmeFor(packageName: string, id: string): string {
  return `# ${packageName}\n\nA Capability package exposing \`${id}\`.\n\n## Start\n\n\`\`\`bash\nnpm install\nnpm test\nnpm run readiness\n\`\`\`\n\nEdit \`src/index.ts\` and the inert manifest in \`package.json\` together. The test suite rejects metadata drift.\n\nBefore publishing, run \`npm run novelty\` to compare the manifest against the live Capability network and avoid shipping a functional twin.\n\n## First publish\n\nThe first npm publication must be authenticated interactively because npm trusted publishing can only be attached after the package exists.\n\n\`\`\`bash\nnpm login\nnpm publish --access public\n\`\`\`\n\nThen configure npm Trusted Publishing for this repository and \`.github/workflows/publish.yml\`. Future releases can use the included tokenless OIDC workflow.\n\n## Join discovery\n\n\`\`\`bash\nnpm run registry-entry\n\`\`\`\n\nSubmit that package entry to a Capability index or host your own index and federate it.\n`;
}

export async function scaffoldCapabilityProject(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const directory = resolve(options.directory);
  const folder = slug(basename(directory));
  const packageName = options.packageName ?? folder;
  const capabilityId = options.capabilityId ?? `${folder}/run`;
  if (!/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/.test(capabilityId)) throw new TypeError("capability id must contain a namespace, for example image/resize");
  const humanName = folder.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  const description = options.description ?? `Perform the ${humanName} capability.`;
  if (await exists(directory) && !options.force) {
    const entries = await import("node:fs/promises").then(({ readdir }) => readdir(directory));
    if (entries.length) throw new Error(`Target directory is not empty: ${directory}. Use --force to write into it.`);
  }
  await mkdir(directory, { recursive: true });
  const manifest = {
    specVersion: "0.1",
    id: capabilityId,
    version: "1.0.0",
    name: humanName,
    description,
    input: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    output: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    effects: [],
    behavior: { deterministic: true, idempotent: true, reversible: false },
    tags: ["starter"]
  } as const;
  const pkg = {
    name: packageName,
    version: "0.1.0",
    description,
    type: "module",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    files: ["dist", "README.md", "LICENSE"],
    sideEffects: false,
    scripts: {
      build: "tsc",
      test: "npm run build && node --test",
      check: "npm test && npm pack --dry-run",
      readiness: "cap readiness package.json",
      novelty: `cap novelty ${capabilityId}`,
      "registry-entry": "cap registry-entry package.json",
      prepublishOnly: "npm run check"
    },
    license: "MIT",
    ...(options.repository ? { repository: { type: "git", url: options.repository } } : {}),
    publishConfig: { access: "public" },
    engines: { node: ">=20" },
    dependencies: { "@wheresmycoleslaw/capability": CAPABILITY_RUNTIME_VERSION },
    devDependencies: { typescript: "^5.8.3", "@types/node": "^22.0.0" },
    capability: { specVersion: "0.1", exports: { [capabilityId]: { module: "./dist/index.js", manifest } } }
  };
  const files: Record<string, string> = {
    "package.json": json(pkg),
    "tsconfig.json": json({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", declaration: true, outDir: "dist", rootDir: "src", strict: true, skipLibCheck: true }, include: ["src/**/*.ts"] }),
    "src/index.ts": sourceFor(capabilityId, humanName, description),
    "test/capability.test.mjs": testFor(capabilityId),
    ".gitignore": "node_modules\ndist\n.env\n.DS_Store\ncapability.lock.json\n",
    "LICENSE": "MIT License\n\nCopyright (c) 2026\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n",
    "README.md": readmeFor(packageName, capabilityId),
    ".github/workflows/ci.yml": "name: CI\n\non:\n  push:\n  pull_request:\n\npermissions:\n  contents: read\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n      - run: npm install --ignore-scripts\n      - run: npm run check\n      - run: npm run readiness\n",
    ".github/workflows/publish.yml": "name: Publish\n\non:\n  workflow_dispatch:\n\npermissions:\n  contents: read\n  id-token: write\n\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n          registry-url: https://registry.npmjs.org\n      - run: npm install --ignore-scripts\n      - run: npm run check\n      - run: npm install --global npm@11\n      - run: npm publish\n"
  };
  for (const [relative, content] of Object.entries(files)) {
    const destination = join(directory, relative);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }
  return { directory, packageName, capabilityId, files: Object.keys(files).sort() };
}

export async function assessProjectReadiness(packageJsonPath = "package.json"): Promise<ProjectReadiness> {
  const absolute = resolve(packageJsonPath);
  const root = dirname(absolute);
  const pkg = JSON.parse(await readFile(absolute, "utf8")) as PackageJsonWithCapabilities & Record<string, unknown>;
  const checks: ReadinessCheck[] = [];
  const add = (id: string, status: ReadinessCheck["status"], message: string) => checks.push({ id, status, message });
  const declarationIssues = validatePackageDeclaration(pkg.capability);
  add("package-declaration", declarationIssues.length ? "fail" : "pass", declarationIssues.length ? declarationIssues.join("; ") : "inert capability declaration is valid");
  const exports = pkg.capability?.exports ?? {};
  const bare = Object.entries(exports).filter(([, entry]) => typeof entry === "string").map(([id]) => id);
  add("inert-manifests", bare.length ? "fail" : "pass", bare.length ? `bare executable-only exports cannot be safely discovered: ${bare.join(", ")}` : "all exports carry inert manifests");
  const manifests = Object.values(exports).filter((entry): entry is Exclude<typeof entry, string> => typeof entry !== "string").map((entry) => entry.manifest);
  const undeclaredEffects = manifests.filter((manifest) => manifest.effects === undefined).map((manifest) => manifest.id);
  add("effects", undeclaredEffects.length ? "fail" : "pass", undeclaredEffects.length ? `effects must be explicit, including []: ${undeclaredEffects.join(", ")}` : "every manifest declares its authority surface");
  const incompleteBehavior = manifests.filter((manifest) => manifest.behavior?.deterministic === undefined || manifest.behavior?.idempotent === undefined || manifest.behavior?.reversible === undefined).map((manifest) => manifest.id);
  add("behavior", incompleteBehavior.length ? "warn" : "pass", incompleteBehavior.length ? `complete behavior flags recommended: ${incompleteBehavior.join(", ")}` : "behavior semantics are explicit");
  add("repository", pkg.repository ? "pass" : "warn", pkg.repository ? "source repository declared" : "repository field is recommended for provenance and adoption");
  add("license", typeof pkg.license === "string" ? "pass" : "warn", typeof pkg.license === "string" ? `license: ${pkg.license}` : "license is recommended");
  const scripts = (pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {}) as Record<string, unknown>;
  add("test-script", typeof scripts.test === "string" ? "pass" : "fail", typeof scripts.test === "string" ? "test script present" : "test script is required for a publishable project");
  add("check-script", typeof scripts.check === "string" ? "pass" : "warn", typeof scripts.check === "string" ? "preflight check script present" : "check script recommended");
  for (const [id, path] of [["readme", "README.md"], ["ci", ".github/workflows/ci.yml"], ["publish-workflow", ".github/workflows/publish.yml"]] as const) {
    add(id, await exists(join(root, path)) ? "pass" : "warn", await exists(join(root, path)) ? `${path} present` : `${path} recommended`);
  }
  const failures = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  const score = Math.max(0, Math.round(((checks.length - failures - warnings * 0.35) / checks.length) * 100));
  return { ok: failures === 0, score, checks };
}
