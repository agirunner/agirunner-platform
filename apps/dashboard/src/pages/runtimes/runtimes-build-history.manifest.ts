import type { DashboardCustomizationManifest } from '../../lib/api.js';

export interface RuntimeManifestPacket {
  label: string;
  value: string;
  detail: string;
}

export function buildRuntimeManifestPackets(
  manifest: DashboardCustomizationManifest,
): RuntimeManifestPacket[] {
  const customizations = manifest.customizations ?? {};
  const aptCount = customizations.apt?.length ?? 0;
  const npmCount = customizations.npm_global?.length ?? 0;
  const pipCount = customizations.pip?.length ?? 0;
  const fileCount = customizations.files?.length ?? 0;

  return [
    {
      label: 'Base image',
      value: manifest.base_image || 'No base image',
      detail: `Runtime preset ${manifest.template || 'unspecified'} anchors the current runtime manifest.`,
    },
    {
      label: 'System packages',
      value: String(aptCount + pipCount + npmCount),
      detail: `${aptCount} apt • ${npmCount} npm global • ${pipCount} pip package changes are recorded.`,
    },
    {
      label: 'Managed files',
      value: String(fileCount),
      detail: fileCount > 0
        ? 'Managed files and path mapping are present in this manifest packet.'
        : 'No managed files are attached to this specialist agent image manifest.',
    },
    {
      label: 'Setup path',
      value: customizations.setup_script?.path ?? 'No setup script',
      detail: customizations.setup_script
        ? 'A setup script is part of the runtime handoff.'
        : 'No setup script is recorded for this runtime manifest.',
    },
    {
      label: 'Reasoning levels',
      value: summarizeReasoningLevels(manifest),
      detail: 'Resolved orchestrator and specialist reasoning posture for this runtime image.',
    },
  ];
}

export function formatManifestJson(manifest: DashboardCustomizationManifest): string {
  return JSON.stringify(manifest, null, 2);
}

function summarizeReasoningLevels(manifest: DashboardCustomizationManifest): string {
  const reasoning = manifest.reasoning ?? {};
  const orchestrator = reasoning.orchestrator_level ?? 'default';
  const specialists = reasoning.internal_workers_level ?? 'default';
  return `Orchestrator ${orchestrator} • Specialists ${specialists}`;
}
