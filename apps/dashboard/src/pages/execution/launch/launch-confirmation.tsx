import { CheckCircle, GitBranch, Layers, Play } from 'lucide-react';

import { Button } from '../../../components/ui/button.js';
import type { WizardState } from './launch-wizard-support.js';

export interface LaunchConfirmationProps {
  state: WizardState;
  playbookName: string;
  workspaceName: string;
  stages: string[];
  onLaunch: () => void;
  onBack: () => void;
  isLaunching: boolean;
  onWatchLiveChange: (watchLive: boolean) => void;
}

function SummaryRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '8px 0',
      borderBottom: '1px solid var(--color-border-subtle)',
    }}>
      <span style={{ color: 'var(--color-accent-primary)', flexShrink: 0 }}>{icon}</span>
      <span style={{
        fontSize: '12px',
        color: 'var(--color-text-secondary)',
        width: '100px',
        flexShrink: 0,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: '13px',
        color: 'var(--color-text-primary)',
        fontWeight: 500,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
    </div>
  );
}

export function LaunchConfirmation({
  state,
  playbookName,
  workspaceName,
  stages,
  onLaunch,
  onBack,
  isLaunching,
  onWatchLiveChange,
}: LaunchConfirmationProps): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <section style={{
        padding: '16px',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: '8px',
        backgroundColor: 'var(--color-bg-secondary)',
      }}>
        <h4 style={{
          margin: '0 0 12px 0',
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Summary
        </h4>

        <SummaryRow
          icon={<Layers size={14} />}
          label="Playbook"
          value={playbookName}
        />
        <SummaryRow
          icon={<CheckCircle size={14} />}
          label="Workspace"
          value={workspaceName}
        />
        <SummaryRow
          icon={<GitBranch size={14} />}
          label="Branch"
          value={state.branchName || '(default)'}
        />

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 0',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}>
          <span style={{ color: 'var(--color-accent-primary)', flexShrink: 0 }}>
            <span style={{ fontSize: '14px' }}>$</span>
          </span>
          <span style={{
            fontSize: '12px',
            color: 'var(--color-text-secondary)',
            width: '100px',
            flexShrink: 0,
          }}>
            Budget
          </span>
          <span style={{ fontSize: '13px', color: 'var(--color-text-primary)', fontWeight: 500 }}>
            {state.tokenBudget.toLocaleString()} tokens / ${state.costCapUsd.toFixed(2)} cap
          </span>
        </div>
      </section>

      {stages.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h4 style={{
            margin: 0,
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--color-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            Stages
          </h4>
          <ol style={{
            margin: 0,
            padding: '0 0 0 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            listStyle: 'none',
          }}>
            {stages.map((stage, index) => (
              <li
                key={stage}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  color: 'var(--color-text-primary)',
                }}
              >
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border-subtle)',
                  fontSize: '10px',
                  color: 'var(--color-text-secondary)',
                  flexShrink: 0,
                }}>
                  {index + 1}
                </span>
                {stage}
              </li>
            ))}
          </ol>
        </section>
      )}

      <label style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        cursor: 'pointer',
        fontSize: '13px',
        color: 'var(--color-text-primary)',
      }}>
        <input
          type="checkbox"
          checked={state.watchLive}
          onChange={(e) => onWatchLiveChange(e.target.checked)}
          style={{ cursor: 'pointer', width: '14px', height: '14px' }}
        />
        Watch live after launch
      </label>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={isLaunching}
        >
          Back
        </Button>
        <Button
          type="button"
          onClick={onLaunch}
          disabled={isLaunching}
          style={{
            backgroundColor: 'var(--color-accent-primary)',
            color: '#fff',
            fontWeight: 600,
            padding: '0 24px',
          }}
        >
          <Play size={14} />
          {isLaunching ? 'Launching…' : 'Launch Workflow'}
        </Button>
      </div>
    </div>
  );
}
