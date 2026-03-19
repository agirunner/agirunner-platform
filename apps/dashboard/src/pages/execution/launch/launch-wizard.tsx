import { useState } from 'react';
import { X } from 'lucide-react';

import { Button } from '../../../components/ui/button.js';
import { ConversationalLaunchBar } from './conversational-launch-bar.js';
import { LaunchConfirmation } from './launch-confirmation.js';
import { LaunchParametersForm } from './launch-parameters-form.js';
import { generateDefaultBranch } from './launch-parameters-form.js';
import {
  canAdvance,
  getStepIndex,
  getStepLabel,
  initialWizardState,
  WIZARD_STEPS,
  type WizardState,
  type WizardStep,
} from './launch-wizard-support.js';
import { type PlaybookItem, PlaybookCatalog } from './playbook-catalog.js';
import { WorkspaceCreationForm } from './workspace-creation-form.js';

export interface LaunchWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunch: (state: WizardState) => void;
  playbooks: PlaybookItem[];
  workspaces: Array<{ id: string; name: string }>;
  starredPlaybookIds: string[];
  onTogglePlaybookStar: (id: string) => void;
}

function StepIndicator({
  currentStep,
}: {
  currentStep: WizardStep;
}): JSX.Element {
  const currentIndex = getStepIndex(currentStep);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0',
      padding: '16px 20px 0',
    }}>
      {WIZARD_STEPS.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isActive = index === currentIndex;

        return (
          <div
            key={step}
            style={{ display: 'flex', alignItems: 'center', flex: index < WIZARD_STEPS.length - 1 ? 1 : 'none' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <div style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '10px',
                fontWeight: 600,
                backgroundColor: isCompleted
                  ? 'var(--color-accent-primary)'
                  : isActive
                    ? 'var(--color-accent-primary)'
                    : 'var(--color-bg-secondary)',
                color: isCompleted || isActive ? '#fff' : 'var(--color-text-tertiary)',
                border: isActive || isCompleted
                  ? 'none'
                  : '1px solid var(--color-border-subtle)',
                transition: 'background-color 0.2s',
              }}>
                {isCompleted ? '✓' : index + 1}
              </div>
              <span style={{
                fontSize: '10px',
                color: isActive
                  ? 'var(--color-accent-primary)'
                  : isCompleted
                    ? 'var(--color-text-secondary)'
                    : 'var(--color-text-tertiary)',
                fontWeight: isActive ? 600 : 400,
                whiteSpace: 'nowrap',
              }}>
                {getStepLabel(step)}
              </span>
            </div>

            {index < WIZARD_STEPS.length - 1 && (
              <div style={{
                flex: 1,
                height: '1px',
                backgroundColor: isCompleted
                  ? 'var(--color-accent-primary)'
                  : 'var(--color-border-subtle)',
                margin: '0 4px',
                marginBottom: '16px',
                transition: 'background-color 0.2s',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function WorkspaceStep({
  workspaces,
  selectedId,
  onSelect,
}: {
  workspaces: Array<{ id: string; name: string }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const [showCreationForm, setShowCreationForm] = useState(false);

  if (showCreationForm) {
    return (
      <WorkspaceCreationForm
        onSubmit={(ws) => {
          // In a real implementation, this would call an API then select the new workspace.
          // For now, we signal via a synthetic placeholder.
          const placeholderId = `new:${ws.name}:${ws.repoUrl}`;
          onSelect(placeholderId);
          setShowCreationForm(false);
        }}
        onCancel={() => setShowCreationForm(false)}
        isSubmitting={false}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {workspaces.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <h4 style={{
            margin: 0,
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--color-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            Select Workspace
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => onSelect(ws.id)}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: `1px solid ${selectedId === ws.id ? 'var(--color-accent-primary)' : 'var(--color-border-subtle)'}`,
                  backgroundColor: selectedId === ws.id
                    ? 'var(--color-accent-primary-10, rgba(99,102,241,0.1))'
                    : 'var(--color-bg-secondary)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: 'var(--color-text-primary)',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.15s, background-color 0.15s',
                }}
              >
                {ws.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowCreationForm(true)}
        style={{
          textAlign: 'center',
          padding: '10px 12px',
          borderRadius: '6px',
          border: '1px dashed var(--color-border-subtle)',
          backgroundColor: 'transparent',
          cursor: 'pointer',
          fontSize: '12px',
          color: 'var(--color-accent-primary)',
          fontFamily: 'inherit',
        }}
      >
        + Create New Workspace
      </button>
    </div>
  );
}

export function LaunchWizard({
  isOpen,
  onClose,
  onLaunch,
  playbooks,
  workspaces,
  starredPlaybookIds,
  onTogglePlaybookStar,
}: LaunchWizardProps): JSX.Element | null {
  const [state, setState] = useState<WizardState>(initialWizardState());
  const [currentStep, setCurrentStep] = useState<WizardStep>('playbook');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);

  if (!isOpen) return null;

  function handleClose(): void {
    setState(initialWizardState());
    setCurrentStep('playbook');
    setSearchQuery('');
    setIsLaunching(false);
    onClose();
  }

  function handleNext(): void {
    const currentIndex = getStepIndex(currentStep);
    if (currentIndex < WIZARD_STEPS.length - 1) {
      setCurrentStep(WIZARD_STEPS[currentIndex + 1]);
    }
  }

  function handleBack(): void {
    const currentIndex = getStepIndex(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(WIZARD_STEPS[currentIndex - 1]);
    }
  }

  function handlePlaybookSelect(playbookId: string): void {
    const playbook = playbooks.find((p) => p.id === playbookId);
    setState((prev) => ({
      ...prev,
      playbookId,
      branchName: prev.branchName === '' && playbook !== undefined
        ? generateDefaultBranch(playbook.name)
        : prev.branchName,
    }));
  }

  function handleWorkspaceSelect(workspaceId: string): void {
    setState((prev) => ({ ...prev, workspaceId }));
  }

  function handleLaunch(): void {
    setIsLaunching(true);
    onLaunch(state);
  }

  const selectedPlaybook = playbooks.find((p) => p.id === state.playbookId);
  const selectedWorkspace = workspaces.find((w) => w.id === state.workspaceId);
  const canGoNext = canAdvance(currentStep, state);
  const currentIndex = getStepIndex(currentStep);

  return (
    <>
      <style>{`
        @media (max-width: 767px) {
          .launch-wizard-modal {
            max-width: 100% !important;
            max-height: 100% !important;
            height: 100% !important;
            border-radius: 0 !important;
            border: none !important;
          }
          .launch-wizard-backdrop {
            align-items: flex-start !important;
          }
        }
      `}</style>
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Launch Workflow"
      className="launch-wizard-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-overlay)' as unknown as number,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        fontFamily: 'var(--font-family)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="launch-wizard-modal"
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '85vh',
          backgroundColor: 'var(--color-bg-primary)',
          borderRadius: '12px',
          border: '1px solid var(--color-border-subtle)',
          boxShadow: 'var(--shadow-panel)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px 12px',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}>
          <h2 style={{
            margin: 0,
            fontSize: '16px',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
          }}>
            Launch Workflow
          </h2>
          <button
            type="button"
            aria-label="Close wizard"
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </header>

        <StepIndicator currentStep={currentStep} />

        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
        }}>
          {currentStep === 'playbook' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <ConversationalLaunchBar />
              <PlaybookCatalog
                playbooks={playbooks}
                starredIds={starredPlaybookIds}
                onToggleStar={onTogglePlaybookStar}
                onSelect={handlePlaybookSelect}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
              />
            </div>
          )}

          {currentStep === 'workspace' && (
            <WorkspaceStep
              workspaces={workspaces}
              selectedId={state.workspaceId}
              onSelect={handleWorkspaceSelect}
            />
          )}

          {currentStep === 'parameters' && (
            <LaunchParametersForm
              parameters={[]}
              values={state.parameters}
              onChange={(params) => setState((prev) => ({ ...prev, parameters: params }))}
              branchName={state.branchName}
              onBranchChange={(branch) => setState((prev) => ({ ...prev, branchName: branch }))}
              tokenBudget={state.tokenBudget}
              onTokenBudgetChange={(budget) => setState((prev) => ({ ...prev, tokenBudget: budget }))}
              costCapUsd={state.costCapUsd}
              onCostCapChange={(cap) => setState((prev) => ({ ...prev, costCapUsd: cap }))}
            />
          )}

          {currentStep === 'launch' && (
            <LaunchConfirmation
              state={state}
              playbookName={selectedPlaybook?.name ?? ''}
              workspaceName={selectedWorkspace?.name ?? state.workspaceId ?? ''}
              stages={[]}
              onLaunch={handleLaunch}
              onBack={handleBack}
              isLaunching={isLaunching}
              onWatchLiveChange={(watchLive) => setState((prev) => ({ ...prev, watchLive }))}
            />
          )}
        </div>

        {currentStep !== 'launch' && (
          <footer style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 20px',
            borderTop: '1px solid var(--color-border-subtle)',
            flexShrink: 0,
          }}>
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              disabled={currentIndex === 0}
            >
              Back
            </Button>
            <Button
              type="button"
              onClick={handleNext}
              disabled={!canGoNext}
            >
              {currentIndex === WIZARD_STEPS.length - 2 ? 'Review & Launch' : 'Next'}
            </Button>
          </footer>
        )}
      </div>
    </div>
    </>
  );
}
