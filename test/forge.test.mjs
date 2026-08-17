import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessNativeIntentFit, forgeGitHubAbility } from "../dist/forge.js";

function response(value, status = 200) {
  return new Response(typeof value === "string" ? value : JSON.stringify(value), {
    status,
    headers: { "content-type": typeof value === "string" ? "text/plain" : "application/json" }
  });
}

function fixtureFetch() {
  const commit = "feedface1234567890abcdef1234567890abcdef";
  const files = new Map([
    ["package.json", JSON.stringify({ name: "@acme/text-kit", version: "1.4.0" })],
    ["README.md", "# Text Kit\n\nUse normalizeText to normalize text.\n"],
    ["src/index.ts", `/** Normalize text for identifiers. */\nexport function normalizeText(text: string) {\n  return text.trim().replace(/\\s+/g, " ");\n}\n`],
    ["test/index.test.ts", `import { normalizeText } from "../src/index.js";\nvoid normalizeText;\n`]
  ]);
  const tree = [...files.entries()].map(([path, content], index) => ({ path, type: "blob", sha: `blob${index}`, size: Buffer.byteLength(content) }));
  return async (input) => {
    const url = String(input);
    if (url === "https://api.github.com/repos/acme/text-kit") return response({
      default_branch: "main",
      html_url: "https://github.com/acme/text-kit",
      description: "Text utilities",
      language: "TypeScript",
      archived: false,
      license: { spdx_id: "MIT" }
    });
    if (url === "https://api.github.com/repos/acme/text-kit/commits/main" || url === `https://api.github.com/repos/acme/text-kit/commits/${commit}`) {
      return response({ sha: commit, commit: { tree: { sha: "tree123" } } });
    }
    if (url === "https://api.github.com/repos/acme/text-kit/git/trees/tree123?recursive=1") return response({ truncated: false, tree });
    const prefix = `https://raw.githubusercontent.com/acme/text-kit/${commit}/`;
    if (url.startsWith(prefix)) {
      const path = decodeURIComponent(url.slice(prefix.length)).replace(/%2F/g, "/");
      const file = files.get(path);
      return file === undefined ? response("not found", 404) : response(file);
    }
    if (url === "https://registry.npmjs.org/%40acme%2Ftext-kit") return response({
      name: "@acme/text-kit",
      "dist-tags": { latest: "1.4.0" },
      versions: {
        "1.4.0": {
          name: "@acme/text-kit",
          version: "1.4.0",
          description: "Text utilities",
          repository: { type: "git", url: "git+https://github.com/acme/text-kit.git" },
          gitHead: commit,
          dist: { integrity: "sha512-fixture" }
        }
      }
    });
    return response(`unexpected URL ${url}`, 404);
  };
}

test("intent fit refuses a lexical native near-miss but accepts a specific native match", () => {
  const normalize = { id: "text/normalize", name: "Normalize Text", description: "Normalize whitespace, surrounding space, and letter case in text." };
  const slugify = { id: "text/slugify", name: "Slugify Text", description: "Convert text to a deterministic URL-friendly slug." };
  const miss = assessNativeIntentFit("convert separated text to camel case", normalize);
  assert.equal(miss.accepted, false);
  assert.ok(miss.missing.includes("camel"));
  const hit = assessNativeIntentFit("slugify text", slugify);
  assert.equal(hit.accepted, true);
  assert.equal(hit.coverage, 1);
});

test("forges a mined repository function into an exact npm-backed inert capability", async () => {
  const directory = await mkdtemp(join(tmpdir(), "capability-forge-test-"));
  const forged = await forgeGitHubAbility("acme/text-kit", {
    fetch: fixtureFetch(),
    query: "normalize text",
    symbol: "normalizeText",
    directory,
    force: true
  });

  assert.equal(forged.descriptor.artifact.sourceBinding, "verified-git-head");
  assert.equal(forged.descriptor.artifact.package, "@acme/text-kit");
  assert.equal(forged.descriptor.artifact.version, "1.4.0");
  assert.equal(forged.descriptor.binding.kind, "npm-export");
  assert.equal(forged.descriptor.binding.exportName, "normalizeText");
  assert.equal(forged.descriptor.authority.complete, false);
  assert.equal(forged.mining.commit, forged.descriptor.artifact.gitHead);

  const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  assert.equal(pkg.private, true);
  assert.equal(pkg.dependencies["@acme/text-kit"], "1.4.0");
  assert.equal(pkg.dependencies["@wheresmycoleslaw/capability"], "^0.9.0");
  const manifest = pkg.capability.exports[forged.project.capabilityId].manifest;
  assert.ok(manifest.effects.includes("custom:external.opaque-effects"));
  assert.equal(manifest.metadata.upstreamCommit, forged.descriptor.repository.commit);

  const source = await readFile(join(directory, "src/index.ts"), "utf8");
  assert.match(source, /const exportName = "normalizeText"/);
  assert.match(source, /await import\(packageName\)/);
});

test("default Forge temp roots are traversable by the non-root Docker executor", async () => {
  const forged = await forgeGitHubAbility("acme/text-kit", {
    fetch: fixtureFetch(),
    query: "normalize text",
    symbol: "normalizeText"
  });
  const mode = (await stat(forged.project.directory)).mode & 0o777;
  assert.notEqual(mode & 0o111, 0, `expected executable directory bits, received ${mode.toString(8)}`);
});

test("refuses first execution source binding when npm cannot prove a gitHead", async () => {
  const fetch = fixtureFetch();
  const wrapper = async (input, init) => {
    const url = String(input);
    const res = await fetch(input, init);
    if (url === "https://registry.npmjs.org/%40acme%2Ftext-kit") {
      const json = await res.json();
      delete json.versions["1.4.0"].gitHead;
      return response(json);
    }
    return res;
  };
  await assert.rejects(
    forgeGitHubAbility("acme/text-kit", { fetch: wrapper, query: "normalize text", symbol: "normalizeText" }),
    /cannot prove that the published artifact came from that exact commit/i
  );
});
