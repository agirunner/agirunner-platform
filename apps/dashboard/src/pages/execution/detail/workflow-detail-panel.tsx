import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { DepthLevel } from '../execution-canvas-support.js';
import { DepthDial } from './depth-dial.js';
import { formatElapsed, isWorkflowLive } from './workflow-detail-panel-support.js';

interface WorkflowSummary {
  id: string;
  name: string;
  state: string;
  currentStage?: string;
  playbookName?: string;
  openWorkItems?: number;
  activeAgents?: number;
  costUsd?: number;
  elapsedMs?: number;
}

interface BreadcrumbEntry {
  type: string;
  id?: string;
  label: string;
}

interface WorkflowDetailPanelProps {
  workflow: WorkflowSummary;
  depthLevel: DepthLevel;
  onDepthChange: (level: DepthLevel) => void;
  breadcrumb: BreadcrumbEntry[];
  onBreadcrumbNavigate: (index: number) => void;
  onClose: () => void;
  children: ReactNode;
}

function LiveDot() {
  return (
    <span
      title="Live"
      style={{
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: 'var(--color-status-success)',
        animation: 'pulse 2s infinite',
        flexShrink: 0,
      }}
    />
  );
}

function StatusBar({ workflow }: { workflow: WorkflowSummary }) {
  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      flexWrap: 'wrap',
      fontSize: '11px',
      color: 'var(--color-text-secondary)',
      marginTop: '6px',
    }}>
      {workflow.openWorkItems !== undefined && (
        <span>{workflow.openWorkItems} work items</span>
      )}
      {workflow.activeAgents !== undefined && (
        <span>{workflow.activeAgents} agents</span>
      )}
      {workflow.costUsd !== undefined && (
        <span>${workflow.costUsd.toFixed(2)}</span>
      )}
      {workflow.elapsedMs !== undefined && (
        <span>{formatElapsed(workflow.elapsedMs)}</span>
      )}
    </div>
  );
}

function Breadcrumb({
  entries,
  onNavigate,
}: {
  entries: BreadcrumbEntry[];
  onNavigate: (index: number) => void;
}) {
  return (
    <nav style={{
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      fontSize: '11px',
      color: 'var(--color-text-tertiary)',
      flexWrap: 'wrap',
    }}>
      {entries.map((entry, index) => (
        <span key={`${entry.type}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {index > 0 && <span>/</span>}
          <button
            onClick={() => onNavigate(index)}
            style={{
              background: 'none',
              border: 'none',
              cursor: index < entries.length - 1 ? 'pointer' : 'default',
              padding: '0',
              color: index < entries.length - 1
                ? 'var(--color-accent-primary)'
                : 'var(--color-text-secondary)',
              fontSize: '11px',
              fontFamily: 'inherit',
            }}
          >
            {entry.label}
          </button>
        </span>
      ))}
    </nav>
  );
}

const SWIPE_DISMISS_THRESHOLD = 80;

export function WorkflowDetailPanel({
  workflow,
  depthLevel,
  onDepthChange,
  breadcrumb,
  onBreadcrumbNavigate,
  onClose,
  children,
}: WorkflowDetailPanelProps) {
  const isLive = isWorkflowLive(workflow.state);
  const touchStartX = useRef<number | null>(null);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const deltaX = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    touchStartX.current = null;
    if (deltaX > SWIPE_DISMISS_THRESHOLD) {
      onClose();
    }
  }

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @media (min-width: 768px) and (max-width: 1023px) {
          .workflow-detail-panel {
            width: 80% !important;
          }
          .workflow-detail-panel-backdrop {
            display: block !important;
          }
        }
        @media (max-width: 767px) {
          .workflow-detail-panel {
            width: 100% !important;
            top: 0 !important;
            bottom: 0 !important;
          }
          .workflow-detail-panel-backdrop {
            display: block !important;
          }
        }
      `}</style>
      <div
        className="workflow-detail-panel-backdrop"
        data-testid="workflow-detail-panel-backdrop"
        onClick={onClose}
        style={{
          display: 'none',
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.4)',
          zIndex: 'calc(var(--z-panel) - 1)' as any,
        }}
      />
      <div
        className="workflow-detail-panel"
        data-testid="workflow-detail-panel"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '45%',
          zIndex: 'var(--z-panel)' as any,
          boxShadow: 'var(--shadow-panel)',
          backgroundColor: 'var(--color-bg-primary)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'var(--font-family)',
          overflowY: 'hidden',
        }}
      >
        <header style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {workflow.name}
                </span>
                {workflow.playbookName && (
                  <span style={{
                    fontSize: '10px',
                    padding: '2px 6px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--color-bg-secondary)',
                    color: 'var(--color-text-secondary)',
                    flexShrink: 0,
                  }}>
                    {workflow.playbookName}
                  </span>
                )}
                {workflow.currentStage && (
                  <span style={{
                    fontSize: '10px',
                    color: 'var(--color-text-tertiary)',
                    flexShrink: 0,
                  }}>
                    {workflow.currentStage}
                  </span>
                )}
                {isLive && <LiveDot />}
              </div>
              <StatusBar workflow={workflow} />
            </div>
            <button
              onClick={onClose}
              aria-label="Close panel"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-tertiary)',
                fontSize: '18px',
                lineHeight: 1,
                padding: '2px 4px',
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>

          <div style={{ marginTop: '8px' }}>
            <Breadcrumb entries={breadcrumb} onNavigate={onBreadcrumbNavigate} />
          </div>

          <div style={{ marginTop: '8px' }}>
            <DepthDial value={depthLevel} onChange={onDepthChange} />
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {children}
        </div>
      </div>
    </>
  );
}
