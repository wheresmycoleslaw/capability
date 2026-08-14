import test from "node:test";
import assert from "node:assert/strict";
import {
  CapabilityRuntime,
  DockerExecutor,
  inspectModuleBackedCapability,
  isDockerAvailable,
  permissivePolicy
} from "../dist/index.js";

const enabled = process.env.CAPABILITY_DOCKER_TEST === "1";

test("DockerExecutor runs an inertly acquired capability inside the container boundary", { skip: !enabled }, async () => {
  assert.equal(await isDockerAvailable(), true, "Docker daemon must be available for isolation smoke test");
  const capability = await inspectModuleBackedCapability(new URL("../package.json", import.meta.url).pathname, "text/normalize");
  const runtime = new CapabilityRuntime({ policy: permissivePolicy, executor: new DockerExecutor({ image: "node:24-alpine" }) }).register(capability);
  const receipt = await runtime.invoke("text/normalize", { text: "  Hello   WORLD  ", case: "lower" });
  assert.equal(receipt.status, "succeeded");
  assert.deepEqual(receipt.output, { text: "hello world" });
});
