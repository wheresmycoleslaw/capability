import { forgeGitHubAbility, activateForgedAbility } from "./forge.js";
import { executeOciImage, executePyPiAbility, forgePyPiAbility, inspectOciImage } from "./metabolism.js";
import { MetabolicBinderRegistry, type BinderExecution, type MetabolicBinder, type MetabolicBinding } from "./binders.js";

export type GitHubForgeRequest = {
  repository: string;
  query?: string;
  symbol?: string;
  candidateId?: string;
  allowUnverifiedSource?: boolean;
};

export type GitHubForgeBinding = MetabolicBinding & {
  substrate: "npm";
  forged: Awaited<ReturnType<typeof forgeGitHubAbility>>;
};

export const githubForgeBinder: MetabolicBinder<GitHubForgeRequest, GitHubForgeBinding> = {
  id: "capability/npm-github-forge",
  substrate: "npm",
  discovery: "automatic",
  description: "Mine an ordinary GitHub repository and bind a selected JavaScript/TypeScript export or CLI to an exact npm artifact.",
  async bind(request) {
    const forged = await forgeGitHubAbility(request.repository, {
      query: request.query,
      symbol: request.symbol,
      candidateId: request.candidateId,
      allowUnverifiedSource: request.allowUnverifiedSource
    });
    return {
      binderId: this.id,
      substrate: "npm",
      locator: request.repository,
      immutableArtifact: `${forged.descriptor.artifact.package}@${forged.descriptor.artifact.version}${forged.descriptor.artifact.integrity ? `#${forged.descriptor.artifact.integrity}` : ""}`,
      authority: {
        complete: false,
        effects: [
          ...forged.descriptor.authority.inferredEffects,
          "custom:external.opaque-effects"
        ],
        note: forged.descriptor.authority.note
      },
      evidence: [
        `${forged.descriptor.repository.fullName}@${forged.descriptor.repository.commit}`,
        forged.descriptor.evidence.candidateId,
        forged.descriptor.artifact.sourceBinding
      ],
      metadata: { sourceBinding: forged.descriptor.artifact.sourceBinding },
      forged
    };
  },
  async execute(binding, input, context = {}): Promise<BinderExecution> {
    const receipt = await activateForgedAbility(binding.forged, input, { approved: context.approved === true });
    return {
      status: receipt.status === "succeeded" ? "succeeded" : "failed",
      output: receipt.output,
      receipt: JSON.parse(JSON.stringify(receipt))
    };
  }
};

export type PyPiBinderRequest = {
  package: string;
  version?: string;
  query?: string;
  module?: string;
  symbol?: string;
};

export type PyPiBinding = MetabolicBinding & {
  substrate: "pypi";
  forged: Awaited<ReturnType<typeof forgePyPiAbility>>;
};

export const pypiBinder: MetabolicBinder<PyPiBinderRequest, PyPiBinding> = {
  id: "capability/pypi-wheel",
  substrate: "pypi",
  discovery: "explicit",
  description: "Verify a PyPI wheel by SHA256, mine Python source without importing it, and bind a public function or console script.",
  async bind(request) {
    const forged = await forgePyPiAbility(request.package, request);
    return {
      binderId: this.id,
      substrate: "pypi",
      locator: request.package,
      immutableArtifact: `${forged.artifact.name}@${forged.artifact.version}#sha256:${forged.artifact.wheel.sha256}`,
      authority: {
        complete: false,
        effects: forged.authority.effects,
        note: "Wheel identity is verified, but arbitrary Python behavior remains authority-incomplete until audited."
      },
      evidence: [forged.artifact.wheel.filename, `sha256:${forged.artifact.wheel.sha256}`, `${forged.candidate.module}:${forged.candidate.symbol}`],
      metadata: { artifactUrl: forged.artifact.wheel.url },
      forged
    };
  },
  async execute(binding, input, context = {}): Promise<BinderExecution> {
    const receipt = await executePyPiAbility(binding.forged, input as { args?: unknown[]; kwargs?: Record<string, unknown> }, { approved: context.approved === true });
    return {
      status: receipt.status,
      ...(receipt.result !== undefined ? { output: receipt.result } : {}),
      receipt: JSON.parse(JSON.stringify(receipt))
    };
  }
};

export type OciBinderRequest = { image: string };
export type OciBinding = MetabolicBinding & { substrate: "oci"; inspection: Awaited<ReturnType<typeof inspectOciImage>> };

export const ociBinder: MetabolicBinder<OciBinderRequest, OciBinding> = {
  id: "capability/oci-command",
  substrate: "oci",
  discovery: "explicit",
  description: "Pin an OCI/Docker image to an immutable RepoDigest and expose its command surface through a hardened container boundary.",
  async bind(request) {
    const inspection = await inspectOciImage(request.image);
    return {
      binderId: this.id,
      substrate: "oci",
      locator: request.image,
      immutableArtifact: inspection.immutableReference,
      authority: {
        complete: false,
        effects: ["process.spawn", "custom:external.opaque-effects"],
        note: "Container identity is immutable, but the image's internal behavior remains opaque. Network is denied by default."
      },
      evidence: [inspection.id, inspection.immutableReference],
      metadata: {
        ...(inspection.architecture ? { architecture: inspection.architecture } : {}),
        ...(inspection.os ? { os: inspection.os } : {})
      },
      inspection
    };
  },
  async execute(binding, input, context = {}): Promise<BinderExecution> {
    const args = Array.isArray(input) ? input.map(String) : input && typeof input === "object" && Array.isArray((input as any).args) ? (input as any).args.map(String) : [];
    const receipt = await executeOciImage(binding.inspection.immutableReference, args, { approved: context.approved === true });
    return {
      status: receipt.status,
      output: receipt.stdout,
      receipt: JSON.parse(JSON.stringify(receipt))
    };
  }
};

export function createDefaultMetabolicBinderRegistry(): MetabolicBinderRegistry {
  return new MetabolicBinderRegistry()
    .register(githubForgeBinder)
    .register(pypiBinder)
    .register(ociBinder);
}
