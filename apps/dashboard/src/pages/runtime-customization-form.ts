import type {
  DashboardCustomizationBuildInputs,
  DashboardCustomizationManifest,
  DashboardCustomizationTrustEvidence,
  DashboardCustomizationTrustPolicy,
} from '../lib/api.js';

export interface RuntimeCustomizationDraft {
  template: string;
  baseImage: string;
  aptPackages: string;
  npmGlobalPackages: string;
  pipPackages: string;
  managedFiles: string;
  setupScriptPath: string;
  setupScriptSha256: string;
  orchestratorLevel: 'low' | 'medium' | 'high';
  internalWorkersLevel: 'low' | 'medium' | 'high';
  templateVersion: string;
  policyBundleVersion: string;
  lockDigests: string;
  buildArgs: string;
  secretRefs: string;
  environment: string;
  criticalFindings: string;
  highFindings: string;
  sbomFormat: string;
  sbomDigest: string;
  provenanceVerified: boolean;
  provenanceSourceRevision: string;
  provenanceBuilderId: string;
  provenanceDigest: string;
  signatureVerified: boolean;
  signatureIdentity: string;
  autoLink: boolean;
}

export interface DigestDiffRow {
  label: string;
  current: string;
  next: string;
}

export function createInitialCustomizationDraft(): RuntimeCustomizationDraft {
  return {
    template: 'node',
    baseImage: 'ghcr.io/agirunner/runtime@sha256:base',
    aptPackages: '',
    npmGlobalPackages: '',
    pipPackages: '',
    managedFiles: '',
    setupScriptPath: '',
    setupScriptSha256: '',
    orchestratorLevel: 'medium',
    internalWorkersLevel: 'medium',
    templateVersion: '',
    policyBundleVersion: '',
    lockDigests: '',
    buildArgs: '',
    secretRefs: '',
    environment: 'staging',
    criticalFindings: '0',
    highFindings: '0',
    sbomFormat: 'spdx',
    sbomDigest: '',
    provenanceVerified: true,
    provenanceSourceRevision: '',
    provenanceBuilderId: '',
    provenanceDigest: '',
    signatureVerified: true,
    signatureIdentity: '',
    autoLink: false,
  };
}

export function buildCustomizationManifest(
  draft: RuntimeCustomizationDraft,
): DashboardCustomizationManifest {
  const manifest: DashboardCustomizationManifest = {
    template: draft.template.trim(),
    base_image: draft.baseImage.trim(),
    reasoning: {
      orchestrator_level: draft.orchestratorLevel,
      internal_workers_level: draft.internalWorkersLevel,
    },
  };

  const apt = parseLineList(draft.aptPackages);
  const npmGlobal = parseLineList(draft.npmGlobalPackages);
  const pip = parseLineList(draft.pipPackages);
  const files = parseManagedFiles(draft.managedFiles);
  const setupScript = buildSetupScript(draft);

  if (apt.length > 0 || npmGlobal.length > 0 || pip.length > 0 || files.length > 0 || setupScript) {
    manifest.customizations = {};
  }
  if (apt.length > 0) {
    manifest.customizations!.apt = apt;
  }
  if (npmGlobal.length > 0) {
    manifest.customizations!.npm_global = npmGlobal;
  }
  if (pip.length > 0) {
    manifest.customizations!.pip = pip;
  }
  if (files.length > 0) {
    manifest.customizations!.files = files;
  }
  if (setupScript) {
    manifest.customizations!.setup_script = setupScript;
  }

  return manifest;
}

export function buildCustomizationBuildInputs(
  draft: RuntimeCustomizationDraft,
): DashboardCustomizationBuildInputs | undefined {
  const templateVersion = draft.templateVersion.trim();
  const policyBundleVersion = draft.policyBundleVersion.trim();
  const lockDigests = parseKeyValueLines(draft.lockDigests);
  const buildArgs = parseKeyValueLines(draft.buildArgs);
  const secretRefs = parseSecretRefs(draft.secretRefs);

  if (
    templateVersion.length === 0 &&
    policyBundleVersion.length === 0 &&
    Object.keys(lockDigests).length === 0 &&
    Object.keys(buildArgs).length === 0 &&
    secretRefs.length === 0
  ) {
    return undefined;
  }

  return {
    ...(templateVersion ? { template_version: templateVersion } : {}),
    ...(policyBundleVersion ? { policy_bundle_version: policyBundleVersion } : {}),
    ...(Object.keys(lockDigests).length > 0 ? { lock_digests: lockDigests } : {}),
    ...(Object.keys(buildArgs).length > 0 ? { build_args: buildArgs } : {}),
    ...(secretRefs.length > 0 ? { secret_refs: secretRefs } : {}),
  };
}

export function buildCustomizationTrustPolicy(
  draft: RuntimeCustomizationDraft,
): DashboardCustomizationTrustPolicy | undefined {
  const environment = draft.environment.trim();
  return environment ? { environment } : undefined;
}

export function buildCustomizationTrustEvidence(
  draft: RuntimeCustomizationDraft,
): DashboardCustomizationTrustEvidence {
  return {
    vulnerability: {
      critical_findings: parseInteger(draft.criticalFindings),
      high_findings: parseInteger(draft.highFindings),
    },
    sbom: {
      format: draft.sbomFormat.trim(),
      digest: draft.sbomDigest.trim(),
    },
    provenance: {
      verified: draft.provenanceVerified,
      source_revision: draft.provenanceSourceRevision.trim(),
      builder_id: draft.provenanceBuilderId.trim(),
      digest: draft.provenanceDigest.trim(),
    },
    signature: {
      verified: draft.signatureVerified,
      trusted_identity: draft.signatureIdentity.trim(),
    },
  };
}

export function buildDigestDiffRows(values: {
  configuredDigest?: string;
  activeDigest?: string;
  pendingRolloutDigest?: string;
  candidateDigest?: string;
}): DigestDiffRow[] {
  return [
    {
      label: 'Configured',
      current: values.configuredDigest ?? 'unconfigured',
      next: values.candidateDigest ?? values.configuredDigest ?? 'unchanged',
    },
    {
      label: 'Active',
      current: values.activeDigest ?? 'unknown',
      next:
        values.candidateDigest ?? values.pendingRolloutDigest ?? values.activeDigest ?? 'unchanged',
    },
    {
      label: 'Pending rollout',
      current: values.pendingRolloutDigest ?? 'none',
      next: values.candidateDigest ?? values.pendingRolloutDigest ?? 'none',
    },
  ];
}

function buildSetupScript(draft: RuntimeCustomizationDraft) {
  const path = draft.setupScriptPath.trim();
  const sha256 = draft.setupScriptSha256.trim();
  if (!path || !sha256) {
    return undefined;
  }
  return { path, sha256 };
}

function parseLineList(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseManagedFiles(value: string): Array<{ source: string; target: string }> {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [source, target] = line.split('=>').map((item) => item.trim());
      return { source, target };
    })
    .filter((entry) => entry.source && entry.target);
}

function parseKeyValueLines(value: string): Record<string, string> {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .reduce<Record<string, string>>((result, line) => {
      const [key, rawValue] = line.split('=');
      const normalizedKey = key?.trim() ?? '';
      const normalizedValue = rawValue?.trim() ?? '';
      if (normalizedKey && normalizedValue) {
        result[normalizedKey] = normalizedValue;
      }
      return result;
    }, {});
}

function parseSecretRefs(value: string): Array<{ id: string; version: string }> {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [id, version] = line.split('@').map((item) => item.trim());
      return { id, version };
    })
    .filter((entry) => entry.id && entry.version);
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
