import test from "node:test";
import assert from "node:assert/strict";
import { planExternalSearchQueries, discoverExternalSoftware } from "../dist/external-discovery.js";

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

test("natural-language software discovery focuses queries and prefers direct utilities over framework plugins", async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    const parsed = new URL(String(url));
    if (parsed.hostname === "registry.npmjs.org") {
      const query = (parsed.searchParams.get("text") ?? "").toLowerCase();
      if (query === "camel case") {
        return json({ objects: [{ package: { name: "jss-plugin-camel-case", version: "10.10.0", description: "JSS plugin that enables camel case rule properties", keywords: ["jss", "plugin", "camel-case"] } }] });
      }
      if (query === "camelcase") {
        return json({ objects: [{ package: { name: "camelcase", version: "9.0.0", description: "Convert a string to camel case", keywords: ["camelcase"], links: { repository: "https://github.com/sindresorhus/camelcase" } } }] });
      }
      return json({ objects: [] });
    }
    if (parsed.hostname === "api.github.com") return json({ items: [] });
    throw new Error("unexpected URL: " + url);
  };

  const planned = planExternalSearchQueries("convert separated text to camel case");
  assert.ok(planned.includes("camel case"));
  assert.ok(planned.includes("camelcase"));
  assert.deepEqual(planExternalSearchQueries("parse a CSV string into records").slice(0, 1), ["csv"]);

  const result = await discoverExternalSoftware("convert separated text to camel case", { fetch });
  assert.equal(result.results[0]?.name, "camelcase");
  assert.equal(result.results[0]?.source, "npm");
  assert.ok((result.results[0]?.score ?? 0) > (result.results.find((candidate) => candidate.name === "jss-plugin-camel-case")?.score ?? 0));
  assert.ok(calls.some((url) => url.includes("text=camel%20case")));
  assert.ok(calls.some((url) => url.includes("text=camelcase")));
});
