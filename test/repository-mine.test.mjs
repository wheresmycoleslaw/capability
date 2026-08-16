import test from "node:test";
import assert from "node:assert/strict";
import { mineGitHubRepository } from "../dist/repository-mine.js";

function response(value, status = 200) {
  return new Response(typeof value === "string" ? value : JSON.stringify(value), {
    status,
    headers: { "content-type": typeof value === "string" ? "text/plain" : "application/json" }
  });
}

function fixtureFetch() {
  const files = new Map([
    ["package.json", JSON.stringify({ name: "@acme/media-kit", version: "1.4.0", bin: { "media-kit": "./src/cli.ts" } })],
    ["README.md", "# Media Kit\n\nUse `renderVideo()` to turn HTML into a video.\n"],
    ["src/index.ts", `import { writeFile } from "node:fs/promises";\n\n/** Convert HTML into a rendered video and return its output path. */\nexport async function renderVideo(html: string) {\n  const response = await fetch("https://renderer.example/render", { method: "POST", body: html });\n  const bytes = new Uint8Array(await response.arrayBuffer());\n  await writeFile("output.mp4", bytes);\n  return "output.mp4";\n}\n\nexport function normalizeText(text: string) {\n  return text.trim().replace(/\\s+/g, " ");\n}\n`],
    ["src/server.ts", `import express from "express";\nconst router = express.Router();\nrouter.post("/render", async (_req, res) => res.json({ ok: true }));\n`],
    ["test/render.test.ts", `import { renderVideo } from "../src/index.js";\nvoid renderVideo;\n`],
    ["examples/basic.ts", `import { renderVideo } from "../src/index.js";\nawait renderVideo("<h1>Hello</h1>");\n`]
  ]);
  const tree = [...files.entries()].map(([path, content], index) => ({ path, type: "blob", sha: `blob${index}`, size: Buffer.byteLength(content) }));
  return async (input) => {
    const url = String(input);
    if (url === "https://api.github.com/repos/acme/media-kit") return response({
      default_branch: "main",
      html_url: "https://github.com/acme/media-kit",
      description: "Render media from code",
      language: "TypeScript",
      archived: false,
      license: { spdx_id: "MIT" }
    });
    if (url === "https://api.github.com/repos/acme/media-kit/commits/main") return response({ sha: "abcdef1234567890", commit: { tree: { sha: "tree123" } } });
    if (url === "https://api.github.com/repos/acme/media-kit/git/trees/tree123?recursive=1") return response({ truncated: false, tree });
    const prefix = "https://raw.githubusercontent.com/acme/media-kit/abcdef1234567890/";
    if (url.startsWith(prefix)) {
      const path = decodeURIComponent(url.slice(prefix.length)).replace(/%2F/g, "/");
      const file = files.get(path);
      return file === undefined ? response("not found", 404) : response(file);
    }
    return response(`unexpected URL ${url}`, 404);
  };
}

test("mines useful abilities from an unchanged repository and preserves inference boundaries", async () => {
  const report = await mineGitHubRepository("acme/media-kit", { fetch: fixtureFetch(), query: "render video", maxFiles: 20 });
  assert.equal(report.repository.commit, "abcdef1234567890");
  assert.equal(report.packageHints.npm?.name, "@acme/media-kit");
  assert.equal(report.coverage.sourceCoverageRatio, 1);

  const render = report.candidates.find((candidate) => candidate.symbol === "renderVideo");
  assert.ok(render, "renderVideo should be discovered");
  assert.equal(render.executable, false);
  assert.equal(render.authority.complete, false);
  assert.equal(render.confidence.level, "high");
  assert.ok(render.evidence.some((item) => item.kind === "documentation"));
  assert.ok(render.evidence.some((item) => item.kind === "test"));
  assert.ok(render.evidence.some((item) => item.kind === "example"));
  assert.ok(render.effects.some((item) => item.effect === "network.connect"));
  assert.ok(render.effects.some((item) => item.effect === "filesystem.write"));
  assert.equal(render.draftContract.metadata.inferred, true);
  assert.equal(render.draftContract.metadata.authorityComplete, false);

  assert.ok(report.candidates.some((candidate) => candidate.kind === "cli" && candidate.symbol === "media-kit"));
  assert.ok(report.candidates.some((candidate) => candidate.kind === "http-operation" && candidate.name === "POST /render"));
  assert.ok(report.hazards.some((hazard) => /inference, not a trust decision/i.test(hazard)));
});

test("reports incomplete source coverage instead of pretending a sample is complete", async () => {
  const report = await mineGitHubRepository("acme/media-kit", { fetch: fixtureFetch(), maxFiles: 8, maxCandidates: 5 });
  assert.ok(report.coverage.analyzedFiles <= 8);
  assert.ok(report.coverage.sourceCoverageRatio <= 1);
  if (report.coverage.sourceCoverageRatio < 1) {
    assert.ok(report.hazards.some((hazard) => /sampled/i.test(hazard)));
  }
});
