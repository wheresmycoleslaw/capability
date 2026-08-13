import type { CapabilityReceipt, ExecutionOptions, JsonValue } from "./types.js";
import type { CapabilityRuntime } from "./runtime.js";
import { sha256 } from "./utils.js";

export type CapabilityEvalCase = {
  name: string;
  input: unknown;
  approved?: boolean;
  expectedOutput?: unknown;
  expectedOutputHash?: string;
  expect?: (receipt: CapabilityReceipt) => boolean | Promise<boolean>;
};

export type CapabilityEvalResult = { name: string; passed: boolean; receiptId?: string; outputHash?: string; error?: string };
export type CapabilityEvalReport = { capabilityId: string; passed: number; failed: number; total: number; passRate: number; deterministic?: boolean; results: readonly CapabilityEvalResult[] };

export async function runCapabilityEvals(runtime: CapabilityRuntime, capabilityId: string, cases: readonly CapabilityEvalCase[], options: ExecutionOptions = {}): Promise<CapabilityEvalReport> {
  const results: CapabilityEvalResult[] = [];
  for (const testCase of cases) {
    try {
      const receipt = await runtime.invoke(capabilityId, testCase.input, { ...options, approved: testCase.approved ?? options.approved });
      let passed = receipt.status === "succeeded";
      if (testCase.expectedOutput !== undefined) passed &&= sha256(receipt.output) === sha256(testCase.expectedOutput);
      if (testCase.expectedOutputHash !== undefined) passed &&= receipt.outputHash === testCase.expectedOutputHash;
      if (testCase.expect) passed &&= await testCase.expect(receipt);
      results.push({ name: testCase.name, passed, receiptId: receipt.receiptId, ...(receipt.outputHash ? { outputHash: receipt.outputHash } : {}) });
    } catch (error) {
      results.push({ name: testCase.name, passed: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const passed = results.filter((result) => result.passed).length;
  return { capabilityId, passed, failed: results.length - passed, total: results.length, passRate: results.length ? passed / results.length : 1, results };
}

export async function evaluateDeterminism(runtime: CapabilityRuntime, capabilityId: string, input: unknown, runs = 3, options: ExecutionOptions = {}): Promise<{ deterministic: boolean; hashes: readonly string[]; receiptIds: readonly string[] }> {
  if (!Number.isInteger(runs) || runs < 2) throw new TypeError("runs must be an integer >= 2");
  const hashes: string[] = [];
  const receiptIds: string[] = [];
  for (let i = 0; i < runs; i += 1) {
    const receipt = await runtime.invoke(capabilityId, input, options);
    if (!receipt.outputHash) throw new Error(`Execution ${receipt.receiptId} did not produce an output hash`);
    hashes.push(receipt.outputHash);
    receiptIds.push(receipt.receiptId);
  }
  return { deterministic: new Set(hashes).size === 1, hashes, receiptIds };
}

export type SerializableEvalCase = Omit<CapabilityEvalCase, "expect"> & { metadata?: Record<string, JsonValue> };
