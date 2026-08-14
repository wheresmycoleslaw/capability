export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonSchema = Record<string, unknown>;

export const CAPABILITY_SPEC_VERSION = "0.1" as const;
export type CapabilitySpecVersion = typeof CAPABILITY_SPEC_VERSION;

export type BuiltInCapabilityEffect =
  | "filesystem.read"
  | "filesystem.write"
  | "network.connect"
  | "process.spawn"
  | "environment.read"
  | "secrets.read"
  | "database.read"
  | "database.write"
  | "email.send"
  | "git.commit"
  | "git.push";

export type CapabilityEffect = BuiltInCapabilityEffect | `custom:${string}`;

export type CapabilityEffects = {
  filesystem?: { read?: boolean; write?: boolean };
  network?: boolean;
  shell?: boolean;
  environment?: boolean;
};

export type CapabilityBehavior = {
  deterministic?: boolean;
  idempotent?: boolean;
  reversible?: boolean;
};

export type CapabilityManifest = {
  specVersion: CapabilitySpecVersion;
  id: string;
  version: string;
  name: string;
  description: string;
  input?: JsonSchema;
  output?: JsonSchema;
  effects?: readonly CapabilityEffect[];
  behavior?: Readonly<CapabilityBehavior>;
  tags?: readonly string[];
  metadata?: Readonly<Record<string, JsonValue>>;
};

export type CapabilityPlanDetails = {
  summary?: string;
  effects?: readonly CapabilityEffect[];
  data?: JsonValue;
};

export type CapabilityPlan = {
  planId: string;
  capability: Readonly<{ id: string; version: string }>;
  input: unknown;
  inputHash: string;
  effects: readonly CapabilityEffect[];
  summary: string;
  createdAt: string;
  data?: JsonValue;
  fingerprint: string;
};

export type CapabilityVerification = {
  ok: boolean;
  message?: string;
  data?: JsonValue;
};

export type CapabilityContext = {
  readonly manifest: Readonly<CapabilityManifest>;
  readonly plan: Readonly<CapabilityPlan>;
  readonly signal?: AbortSignal;
};

export type RollbackContext<Input, Output> = CapabilityContext & {
  readonly input: Input;
  readonly output: Output;
  readonly receipt: CapabilityReceipt<Input, Output>;
};

export type CapabilityDefinition<Input = unknown, Output = unknown> = {
  manifest: CapabilityManifest;
  execute: (input: Input, context: CapabilityContext) => Output | Promise<Output>;
  plan?: (input: Input) => CapabilityPlanDetails | Promise<CapabilityPlanDetails>;
  verify?: (output: Output, context: CapabilityContext) => boolean | CapabilityVerification | Promise<boolean | CapabilityVerification>;
  rollback?: (context: RollbackContext<Input, Output>) => unknown | Promise<unknown>;
};

export type LegacyCapabilityDefinition<Input = unknown, Output = unknown> = {
  id?: string;
  version?: string;
  name: string;
  description: string;
  input?: JsonSchema;
  output?: JsonSchema;
  effects?: CapabilityEffects | readonly CapabilityEffect[];
  behavior?: CapabilityBehavior;
  tags?: readonly string[];
  execute: (input: Input) => Output | Promise<Output>;
};

export type Capability<Input = unknown, Output = unknown> = {
  readonly manifest: Readonly<CapabilityManifest>;
  readonly execute: CapabilityDefinition<Input, Output>["execute"];
  readonly plan?: CapabilityDefinition<Input, Output>["plan"];
  readonly verify?: CapabilityDefinition<Input, Output>["verify"];
  readonly rollback?: CapabilityDefinition<Input, Output>["rollback"];
};

export type CapabilityInspection = Readonly<CapabilityManifest> & { readonly executable: false };

export type CapabilityReceiptStatus = "succeeded" | "failed" | "rolled_back" | "rollback_failed";

export type SerializedError = { name: string; message: string; code?: string };

export type CapabilityReceipt<Input = unknown, Output = unknown> = {
  receiptId: string;
  planId: string;
  capability: Readonly<{ id: string; version: string }>;
  status: CapabilityReceiptStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  effects: readonly CapabilityEffect[];
  inputHash: string;
  outputHash?: string;
  input?: Input;
  output?: Output;
  verification?: CapabilityVerification;
  error?: SerializedError;
  rollbackResult?: unknown;
  metadata?: Readonly<Record<string, JsonValue>>;
  provenance?: Readonly<CapabilityProvenance>;
};

export type AuthorizationDecision = {
  allowed: boolean;
  deniedEffects: readonly CapabilityEffect[];
  approvalRequired: readonly CapabilityEffect[];
  reason?: string;
};

export type CapabilityPolicy = {
  allow?: readonly string[];
  deny?: readonly string[];
  requireApproval?: readonly string[];
};

export type DiscoveryQuery = {
  text: string;
  limit?: number;
  tags?: readonly string[];
  effects?: readonly CapabilityEffect[];
};

export type DiscoveryResult = {
  capability: Capability;
  score: number;
  reasons: readonly string[];
};

export type ExecutionOptions = {
  approved?: boolean;
  signal?: AbortSignal;
  metadata?: Readonly<Record<string, JsonValue>>;
};

export type CapabilityProvenance = {
  source?: string;
  packageRoot?: string;
  installRoot?: string;
  packageName?: string;
  packageVersion?: string;
  packageIntegrity?: string;
  repository?: string;
  commit?: string;
  integrity?: string;
  attestation?: string;
  registrySignatureVerified?: boolean;
  provenanceVerified?: boolean;
  verificationProvider?: string;
  verifiedAt?: string;
};

export type DiscoveryRanker = {
  score(query: string, manifests: readonly Readonly<CapabilityManifest>[]): readonly number[] | Promise<readonly number[]>;
};
