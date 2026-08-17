import { METABOLIC_BINDING_VERSION, METABOLIC_EXECUTION_RECEIPT_VERSION } from "./binders.js";
import { CAPABILITY_BRIDGE_VERSION } from "./bridge.js";
import { CAPABILITY_METABOLISM_VERSION } from "./metabolism.js";
import { CAPABILITY_INDEX_VERSION } from "./public-index.js";
import { CAPABILITY_SPEC_VERSION } from "./types.js";
import { CAPABILITY_SITE_DISCOVERY_VERSION } from "./web-discovery.js";

/** Package/protocol stability line. Subordinate document formats version independently. */
export const CAPABILITY_PROTOCOL_VERSION = "1.0" as const;
export const CAPABILITY_STABILITY_LINE = "1.x" as const;

export const CAPABILITY_PROTOCOL_GUARANTEES = [
  "discovery-is-not-trust",
  "artifact-identity-is-not-safety",
  "authorization-is-host-owned",
  "unknown-authority-is-preserved",
  "executable-bindings-identify-immutable-artifacts",
  "isolation-is-an-explicit-boundary",
  "execution-attempts-leave-receipts",
  "breaking-public-contract-changes-require-a-new-major-version"
] as const;

export type CapabilityProtocolInfo = {
  protocolVersion: typeof CAPABILITY_PROTOCOL_VERSION;
  stabilityLine: typeof CAPABILITY_STABILITY_LINE;
  formats: {
    manifest: typeof CAPABILITY_SPEC_VERSION;
    index: typeof CAPABILITY_INDEX_VERSION;
    siteDiscovery: typeof CAPABILITY_SITE_DISCOVERY_VERSION;
    bridge: typeof CAPABILITY_BRIDGE_VERSION;
    metabolism: typeof CAPABILITY_METABOLISM_VERSION;
    gap: "0.1";
    metabolicBinding: typeof METABOLIC_BINDING_VERSION;
    metabolicExecutionReceipt: typeof METABOLIC_EXECUTION_RECEIPT_VERSION;
  };
  guarantees: typeof CAPABILITY_PROTOCOL_GUARANTEES;
};

export function capabilityProtocolInfo(): CapabilityProtocolInfo {
  return {
    protocolVersion: CAPABILITY_PROTOCOL_VERSION,
    stabilityLine: CAPABILITY_STABILITY_LINE,
    formats: {
      manifest: CAPABILITY_SPEC_VERSION,
      index: CAPABILITY_INDEX_VERSION,
      siteDiscovery: CAPABILITY_SITE_DISCOVERY_VERSION,
      bridge: CAPABILITY_BRIDGE_VERSION,
      metabolism: CAPABILITY_METABOLISM_VERSION,
      gap: "0.1",
      metabolicBinding: METABOLIC_BINDING_VERSION,
      metabolicExecutionReceipt: METABOLIC_EXECUTION_RECEIPT_VERSION
    },
    guarantees: CAPABILITY_PROTOCOL_GUARANTEES
  };
}

export function isCapabilityProtocolCompatible(version: string): boolean {
  const match = /^(\d+)\.(\d+)(?:\.\d+)?(?:[-+].*)?$/.exec(version.trim());
  return Boolean(match && Number(match[1]) === 1);
}

export function assertCapabilityProtocolCompatible(version: string): void {
  if (!isCapabilityProtocolCompatible(version)) {
    throw new TypeError(`Capability protocol ${version} is not compatible with the ${CAPABILITY_STABILITY_LINE} contract`);
  }
}
