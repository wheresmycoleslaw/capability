import test from "node:test";
import assert from "node:assert/strict";
import { contractsCompose, createCapabilityGap, metabolicCoverage, planComposition } from "../dist/metabolism.js";

test("coverage names generalized substrate families", () => {
  const report = metabolicCoverage();
  for (const name of ["native","npm","pypi","oci","mcp","openapi","repository","composition","gap"]) assert.ok(report.entries.some((x) => x.substrate === name));
});

test("composition rejects known contract contradictions", () => {
  assert.equal(contractsCompose({type:"string"},{type:"object"}).compatible,false);
  assert.equal(contractsCompose({type:"object",properties:{x:{type:"string"}}},{type:"object",required:["x"]}).compatible,true);
  assert.equal(contractsCompose({type:"object",properties:{}},{type:"object",required:["x"]}).compatible,false);
});

test("composition planner produces schema-compatible pipelines", () => {
  const plans=planComposition("transform",[
    {id:"a",name:"a",description:"a",output:{type:"object",properties:{x:{type:"string"}}},effects:[],score:1},
    {id:"b",name:"b",description:"b",input:{type:"object",required:["x"]},output:{type:"string"},effects:[],score:1}
  ]);
  assert.ok(plans.some((p)=>p.steps.map((x)=>x.id).join(",")==="a,b"));
});

test("gap is machine-readable and conservative", () => {
  const gap=createCapabilityGap("do impossible thing",{effectsCeiling:["filesystem.read"]});
  assert.equal(gap.status,"unresolved");
  assert.deepEqual(gap.required.effectsCeiling,["filesystem.read"]);
});
