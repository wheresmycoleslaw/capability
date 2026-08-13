import type { CapabilityReceipt } from "./types.js";

export interface ReceiptStore {
  put(receipt: CapabilityReceipt): Promise<void> | void;
  get(receiptId: string): Promise<CapabilityReceipt | undefined> | CapabilityReceipt | undefined;
  list(): Promise<CapabilityReceipt[]> | CapabilityReceipt[];
}

export class MemoryReceiptStore implements ReceiptStore {
  private readonly receipts = new Map<string, CapabilityReceipt>();
  put(receipt: CapabilityReceipt): void { this.receipts.set(receipt.receiptId, Object.freeze({ ...receipt })); }
  get(receiptId: string): CapabilityReceipt | undefined { return this.receipts.get(receiptId); }
  list(): CapabilityReceipt[] { return [...this.receipts.values()]; }
}
