import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expandProviderEnvironment, loadProviderConfig } from "../dist/providers.js";
import { need } from "../dist/need.js";

test("provider environment expansion fails closed when a secret is missing", () => {
  assert.throws(
    () => expandProviderEnvironment({ authorization: "Bearer ${MISSING_TOKEN}" }, {}),
    /Missing provider environment variable: MISSING_TOKEN/
  );
});

test("OpenAPI provider config becomes an ordinary prepared ability source", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "capability-provider-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const openapiPath = join(root, "service.json");
  const configPath = join(root, "capability.providers.json");
  await writeFile(openapiPath, JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Health Service", version: "1.0.0" },
    servers: [{ url: "https://api.example.test" }],
    paths: {
      "/health": {
        get: {
          operationId: "getHealth",
          summary: "Get health status",
          responses: { "200": { description: "ok" } }
        }
      }
    }
  }));
  await writeFile(configPath, JSON.stringify({
    providers: [{
      type: "openapi",
      id: "health-service",
      source: openapiPath,
      namespace: "health",
      priority: 10,
      trusted: true
    }]
  }));

  const loaded = await loadProviderConfig(configPath);
  t.after(() => loaded.close());
  assert.deepEqual(loaded.sources, [{ id: "health-service", type: "openapi", abilities: 1 }]);

  const resolution = await need("get health status", { providers: loaded.registry });
  assert.equal(resolution.status, "ready");
  assert.equal(resolution.provider, "health-service");
  assert.equal(resolution.source, "openapi");
});
