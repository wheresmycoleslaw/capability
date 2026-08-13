export type CapabilityErrorCode =
  | "INVALID_MANIFEST"
  | "INVALID_INPUT"
  | "INVALID_OUTPUT"
  | "NOT_FOUND"
  | "DUPLICATE_CAPABILITY"
  | "PERMISSION_DENIED"
  | "APPROVAL_REQUIRED"
  | "INVALID_PLAN"
  | "EXECUTION_FAILED"
  | "VERIFY_FAILED"
  | "ROLLBACK_UNAVAILABLE"
  | "ROLLBACK_FAILED"
  | "INVALID_PACKAGE_DECLARATION";

export class CapabilityError extends Error {
  readonly code: CapabilityErrorCode;
  readonly details?: unknown;

  constructor(code: CapabilityErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "CapabilityError";
    this.code = code;
    this.details = details;
  }
}

export function asSerializedError(error: unknown): { name: string; message: string; code?: string } {
  if (error instanceof CapabilityError) return { name: error.name, message: error.message, code: error.code };
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "Error", message: String(error) };
}
