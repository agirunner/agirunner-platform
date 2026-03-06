import type {
  DashboardCustomizationBuildResponse,
  DashboardCustomizationInspectResponse,
  DashboardCustomizationLinkResponse,
  DashboardCustomizationStatusResponse,
  DashboardCustomizationValidateResponse,
} from '../lib/api.js';
import type { DigestDiffRow } from './runtime-customization-form.js';

export function StatusPanel({
  status,
  isLoading,
}: {
  status?: DashboardCustomizationStatusResponse;
  isLoading: boolean;
}): JSX.Element {
  return (
    <div className="card">
      <h3>Runtime Status</h3>
      {isLoading ? <p>Loading runtime status…</p> : null}
      {status ? (
        <dl className="grid">
          <StatRow label="State" value={status.state} />
          <StatRow label="Configured digest" value={status.configured_digest ?? 'unconfigured'} />
          <StatRow label="Active digest" value={status.active_digest ?? 'unknown'} />
          <StatRow label="Pending rollout digest" value={status.pending_rollout_digest ?? 'none'} />
          <StatRow
            label="Resolved orchestrator reasoning"
            value={status.resolved_reasoning.orchestrator_level ?? 'medium'}
          />
          <StatRow
            label="Resolved internal worker reasoning"
            value={status.resolved_reasoning.internal_workers_level ?? 'medium'}
          />
        </dl>
      ) : null}
    </div>
  );
}

export function GatePanel({
  validation,
  build,
  link,
}: {
  validation: DashboardCustomizationValidateResponse | null;
  build: DashboardCustomizationBuildResponse | null;
  link: DashboardCustomizationLinkResponse | null;
}): JSX.Element {
  return (
    <div className="card">
      <h3>Build and Gate Review</h3>
      {validation ? (
        <>
          <div className="row">
            <span className={`status-badge status-${validation.valid ? 'completed' : 'failed'}`}>
              {validation.valid ? 'valid' : 'invalid'}
            </span>
          </div>
          {validation.errors?.length ? (
            <ul>
              {validation.errors.map((error) => (
                <li key={`${error.rule_id}:${error.field_path}`}>
                  <strong>{error.field_path}</strong> {error.message} ({error.remediation})
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              Inline validation uses the same schema and policy rules as CLI and API.
            </p>
          )}
        </>
      ) : (
        <p className="muted">Validate first to see remediation guidance.</p>
      )}

      {build ? (
        <>
          <dl className="grid">
            <StatRow label="Build id" value={build.build_id ?? 'pending'} />
            <StatRow label="Digest" value={build.digest ?? 'pending'} />
            <StatRow label="CIIH" value={build.ciih ?? 'pending'} />
            <StatRow
              label="Link readiness"
              value={build.link_ready ? 'ready' : (build.link_blocked_reason ?? 'blocked')}
            />
          </dl>
          {build.gates?.length ? (
            <ul>
              {build.gates.map((gate) => (
                <li key={gate.name}>
                  <strong>{gate.name}</strong> {gate.status}
                  {gate.message ? `: ${gate.message}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {link ? (
        <div className="card">
          <h4>Link Result</h4>
          <dl className="grid">
            <StatRow label="Linked" value={link.linked ? 'yes' : 'no'} />
            <StatRow label="Configured digest" value={link.configured_digest ?? 'unchanged'} />
            <StatRow label="Active digest" value={link.active_digest ?? 'unchanged'} />
          </dl>
        </div>
      ) : null}
    </div>
  );
}

export function summarizeGates(build: DashboardCustomizationBuildResponse | null): {
  passed: number;
  failed: number;
  blocked: number;
} {
  return (build?.gates ?? []).reduce(
    (summary, gate) => {
      if (gate.status === 'passed') {
        summary.passed += 1;
      } else if (gate.status === 'failed') {
        summary.failed += 1;
      } else {
        summary.blocked += 1;
      }
      return summary;
    },
    { passed: 0, failed: 0, blocked: 0 },
  );
}

export function DigestDiffPanel({ rows }: { rows: DigestDiffRow[] }): JSX.Element {
  return (
    <div className="card">
      <h3>Digest Diff Summary</h3>
      <p className="muted">
        Compare configured, active, and pending rollout digests before link approval.
      </p>
      <table>
        <thead>
          <tr>
            <th align="left">Digest</th>
            <th align="left">Current</th>
            <th align="left">Next</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.current}</td>
              <td>{row.next}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReconstructionPanel({
  reconstruction,
  exportedArtifact,
  isLoading,
  isExporting,
  onExport,
}: {
  reconstruction?: DashboardCustomizationInspectResponse;
  exportedArtifact: string;
  isLoading: boolean;
  isExporting: boolean;
  onExport: (artifactType: 'profile' | 'template') => Promise<void>;
}): JSX.Element {
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h3>Reusable Profiles and Templates</h3>
          <p className="muted">
            Save validated customizations as reusable profile/template exports for later
            application.
          </p>
        </div>
        <div className="row">
          <button
            className="button"
            type="button"
            onClick={() => void onExport('profile')}
            disabled={isExporting}
          >
            {isExporting ? 'Saving…' : 'Save profile'}
          </button>
          <button
            className="button"
            type="button"
            onClick={() => void onExport('template')}
            disabled={isExporting}
          >
            {isExporting ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>
      {isLoading ? <p>Loading reconstructed runtime state…</p> : null}
      {reconstruction ? (
        <dl className="grid">
          <StatRow
            label="Profile checksum"
            value={reconstruction.profile.manifest_checksum ?? 'pending'}
          />
          <StatRow
            label="Latest gated digest"
            value={reconstruction.profile.latest_gated_digest ?? 'pending'}
          />
          <StatRow
            label="Confidence map"
            value={JSON.stringify(reconstruction.field_confidence ?? {}, null, 2)}
          />
        </dl>
      ) : null}
      {exportedArtifact ? (
        <div className="card">
          <h4>Export Preview</h4>
          <pre>{exportedArtifact}</pre>
        </div>
      ) : null}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <>
      <dt className="muted">{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </>
  );
}
