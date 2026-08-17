import test from "node:test";
import assert from "node:assert/strict";
import { MetabolicBinderRegistry } from "../dist/binders.js";
import { createDefaultMetabolicBinderRegistry } from "../dist/default-binders.js";
import { splitPipelineIntent } from "../dist/metabolic-compose.js";

test("default binders generalize by substrate", () => {
  const rows=createDefaultMetabolicBinderRegistry().list();
  assert.deepEqual(new Set(rows.map((x)=>x.substrate)), new Set(["npm","pypi","oci"]));
  assert.ok(rows.every((x)=>x.executable));
});

test("binder ids are unique", () => {
  const registry=new MetabolicBinderRegistry();
  const binder={id:"demo/x",substrate:"demo",discovery:"explicit",description:"demo",async bind(){return {binderId:"demo/x",substrate:"demo",locator:"x",authority:{complete:false,effects:[]},evidence:[]}}};
  registry.register(binder);
  assert.throws(()=>registry.register(binder),/already registered/);
});

test("pipeline intent is split without inventing hidden steps", () => {
  assert.deepEqual(splitPipelineIntent("normalize text then slugify text"),["normalize text","slugify text"]);
  assert.deepEqual(splitPipelineIntent("extract -> transform -> render"),["extract","transform","render"]);
});
