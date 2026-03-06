import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  dashboardApi,
  type DashboardCustomizationBuildResponse,
  type DashboardCustomizationLinkResponse,
  type DashboardCustomizationValidateResponse,
} from '../lib/api.js';
import {
  buildCustomizationBuildInputs,
  buildCustomizationManifest,
  buildCustomizationTrustEvidence,
  buildCustomizationTrustPolicy,
  buildDigestDiffRows,
  createInitialCustomizationDraft,
  type RuntimeCustomizationDraft,
} from './runtime-customization-form.js';
import {
  DigestDiffPanel,
  GatePanel,
  ReconstructionPanel,
  StatusPanel,
} from './runtime-customization-support.js';
import { RuntimeCustomizationEditor } from './runtime-customization-editor.js';

export function RuntimeCustomizationPage(): JSX.Element {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ['runtime-customization-status'],
    queryFn: () => dashboardApi.getCustomizationStatus(),
  });
  const reconstructQuery = useQuery({
    queryKey: ['runtime-customization-reconstruct'],
    queryFn: () => dashboardApi.reconstructCustomization(),
  });

  const [draft, setDraft] = useState<RuntimeCustomizationDraft>(() =>
    createInitialCustomizationDraft(),
  );
  const [validation, setValidation] = useState<DashboardCustomizationValidateResponse | null>(null);
  const [build, setBuild] = useState<DashboardCustomizationBuildResponse | null>(null);
  const [link, setLink] = useState<DashboardCustomizationLinkResponse | null>(null);
  const [exportedArtifact, setExportedArtifact] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const manifest = buildCustomizationManifest(draft);
  const digestRows = buildDigestDiffRows({
    configuredDigest: statusQuery.data?.configured_digest,
    activeDigest: statusQuery.data?.active_digest,
    pendingRolloutDigest: statusQuery.data?.pending_rollout_digest,
    candidateDigest: link?.configured_digest ?? build?.digest,
  });

  function updateDraft<K extends keyof RuntimeCustomizationDraft>(
    field: K,
    value: RuntimeCustomizationDraft[K],
  ): void {
    setDraft((current: RuntimeCustomizationDraft) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleValidate(): Promise<void> {
    try {
      setIsValidating(true);
      setActionError(null);
      setValidation(await dashboardApi.validateCustomization({ manifest }));
    } catch {
      setActionError('Validation failed. Review the draft and retry.');
    } finally {
      setIsValidating(false);
    }
  }

  async function handleBuild(): Promise<void> {
    try {
      setIsBuilding(true);
      setActionError(null);
      setLink(null);
      setBuild(
        await dashboardApi.createCustomizationBuild({
          manifest,
          auto_link: draft.autoLink,
          inputs: buildCustomizationBuildInputs(draft),
          trust_policy: buildCustomizationTrustPolicy(draft),
          trust_evidence: buildCustomizationTrustEvidence(draft),
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ['runtime-customization-status'] });
    } catch {
      setActionError('Build submission failed. Check runtime reachability and trust inputs.');
    } finally {
      setIsBuilding(false);
    }
  }

  async function handleLink(): Promise<void> {
    if (!build?.build_id) {
      setActionError('Build a candidate before linking.');
      return;
    }

    try {
      setIsLinking(true);
      setActionError(null);
      setLink(await dashboardApi.linkCustomizationBuild({ build_id: build.build_id }));
      await queryClient.invalidateQueries({ queryKey: ['runtime-customization-status'] });
    } catch {
      setActionError('Link failed. Review gate status and digest readiness.');
    } finally {
      setIsLinking(false);
    }
  }

  async function handleExport(artifactType: 'profile' | 'template'): Promise<void> {
    try {
      setIsExporting(true);
      setActionError(null);
      const response = await dashboardApi.exportCustomization({
        artifact_type: artifactType,
        format: 'yaml',
      });
      setExportedArtifact(response.content ?? '');
      await queryClient.invalidateQueries({ queryKey: ['runtime-customization-reconstruct'] });
    } catch {
      setActionError('Export failed. Reconstruct the runtime state and retry.');
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className="grid">
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2>Runtime Customization</h2>
            <p className="muted">
              Guided authoring inside the existing dashboard with shared validation, Build and gate
              review, digest diff, and export flow.
            </p>
          </div>
          <div className="row">
            <button
              className="button"
              type="button"
              onClick={() => void handleValidate()}
              disabled={isValidating}
            >
              {isValidating ? 'Validating…' : 'Validate'}
            </button>
            <button
              className="button primary"
              type="button"
              onClick={() => void handleBuild()}
              disabled={isBuilding}
            >
              {isBuilding ? 'Building…' : 'Build'}
            </button>
            <button
              className="button"
              type="button"
              onClick={() => void handleLink()}
              disabled={isLinking || !build?.link_ready}
            >
              {isLinking ? 'Linking…' : 'Link'}
            </button>
          </div>
        </div>

        <RuntimeCustomizationEditor draft={draft} onChange={updateDraft} />

        <div className="card">
          <h3>Guided authoring</h3>
          <p className="muted">
            Configured digest and Pending rollout digest remain visible before link decisions are
            made.
          </p>
          <h3>Manifest Preview</h3>
          <pre>{JSON.stringify(manifest, null, 2)}</pre>
        </div>
        {actionError ? <p style={{ color: '#dc2626' }}>{actionError}</p> : null}
      </section>

      <div className="grid two">
        <StatusPanel status={statusQuery.data} isLoading={statusQuery.isLoading} />
        <GatePanel validation={validation} build={build} link={link} />
      </div>

      <div className="grid two">
        <DigestDiffPanel rows={digestRows} />
        <ReconstructionPanel
          reconstruction={reconstructQuery.data}
          exportedArtifact={exportedArtifact}
          isLoading={reconstructQuery.isLoading}
          isExporting={isExporting}
          onExport={handleExport}
        />
      </div>
    </section>
  );
}
