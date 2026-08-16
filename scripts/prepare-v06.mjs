import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
pkg.version = "0.6.0";
pkg.description = "An open standard and runtime for agents to discover native abilities and existing software, bridge external tools, inspect authority, verify artifacts, and execute with receipts.";
pkg.exports["./external-discovery"] = { types: "./dist/external-discovery.d.ts", import: "./dist/external-discovery.js" };
pkg.exports["./bridge"] = { types: "./dist/bridge.d.ts", import: "./dist/bridge.js" };
pkg.exports["./mcp-import"] = { types: "./dist/mcp-import.d.ts", import: "./dist/mcp-import.js" };
for (const file of ["UNIVERSAL.md", "capability-bridge.schema.json"]) if (!pkg.files.includes(file)) pkg.files.push(file);
for (const keyword of ["external-software", "software-discovery", "sidecar", "bridge", "mcp-import", "npm-adapter", "universal-tools"]) if (!pkg.keywords.includes(keyword)) pkg.keywords.push(keyword);
await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

const scaffoldPath = new URL("../src/scaffold.ts", import.meta.url);
let scaffold = await readFile(scaffoldPath, "utf8");
scaffold = scaffold.replace('const CAPABILITY_RUNTIME_VERSION = "^0.4.0";', 'const CAPABILITY_RUNTIME_VERSION = "^0.6.0";');
await writeFile(scaffoldPath, scaffold, "utf8");

const readmePath = new URL("../README.md", import.meta.url);
let readme = await readFile(readmePath, "utf8");
readme = readme.replace(
  "The bridge gives the agent five stable tools—search, inspect, execute, website probe, and doctor—without dumping the entire Capability network into the model context.",
  "The bridge gives the agent a small stable surface for native search, software-world search, inspection, execution, website probing, and diagnostics—without dumping the entire Capability network into the model context."
);
const universalSection = `## Search beyond Capability\n\nCapability no longer requires useful software to have been authored inside the Capability ecosystem before it can be found.\n\n\`\`\`bash\ncap world "render html to video"\n\`\`\`\n\n\`cap world\` returns two deliberately separate classes of results:\n\n- **native** — executable Capability contracts that can proceed through normal resolution, verification, authorization, isolation, and receipts;\n- **external** — npm packages and GitHub repositories that may already solve the problem but are only candidates until an adapter/importer supplies a defensible machine-readable contract.\n\nExisting software does not need to be rewritten. An existing npm CLI can be wrapped in a thin sidecar:\n\n\`\`\`bash\ncap npm-inspect some-package\ncap bridge npm some-package ./some-package-cap --id vendor/ability --bin some-command\n\`\`\`\n\nAn unchanged MCP server can be imported into Capability contracts at runtime:\n\n\`\`\`bash\ncap mcp-import node ./server.mjs --namespace existing-server\n\`\`\`\n\nUnknown external side effects remain explicit through opaque-authority markers until a bridge author audits them. Capability does not turn search results into trusted code by declaration. See [UNIVERSAL.md](./UNIVERSAL.md).\n\n`;
if (!readme.includes("## Search beyond Capability")) {
  const marker = "## Create a capability\n";
  if (!readme.includes(marker)) throw new Error("README insertion marker not found");
  readme = readme.replace(marker, `${universalSection}${marker}`);
}
if (!readme.includes("[Universal software discovery and bridges](./UNIVERSAL.md)")) {
  readme = readme.replace("- [Adoption guide](./ADOPTION.md)\n", "- [Adoption guide](./ADOPTION.md)\n- [Universal software discovery and bridges](./UNIVERSAL.md)\n");
}
await writeFile(readmePath, readme, "utf8");

await execFileAsync(process.execPath, [new URL("./generate-registry.mjs", import.meta.url).pathname, "--write"], { cwd: new URL("..", import.meta.url).pathname });
console.log("Prepared Capability 0.6.0 package, docs, scaffold runtime, and registry.");
