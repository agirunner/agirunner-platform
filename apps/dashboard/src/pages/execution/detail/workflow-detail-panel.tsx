import { useRef } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils.js';
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
  pendingActionCount?: number;
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
  onOpenResources?: () => void;
  children: ReactNode;
}

function LiveDot() {
  return (
    <span
      title="Live"
      className="inline-block w-2 h-2 rounded-full shrink-0 bg-[var(--color-status-success)] animate-pulse"
    />
  );
}

function PendingActionsBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 cursor-default"
      style={{
        color: 'var(--color-status-warning)',
        backgroundColor: 'color-mix(in srgb, var(--color-status-warning) 15%, transparent)',
        border: '1px solid color-mix(in srgb, var(--color-status-warning) 30%, transparent)',
      }}
      title={`${count} pending action${count > 1 ? 's' : ''}`}
    >
      {count} pending
    </span>
  );
}

function StatusBar({ workflow }: { workflow: WorkflowSummary }) {
  return (
    <div className="flex gap-3 flex-wrap text-[11px] text-[var(--color-text-secondary)] mt-1.5">
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
    <nav className="flex items-center gap-1 text-[11px] text-[var(--color-text-tertiary)] flex-wrap">
      {entries.map((entry, index) => (
        <span key={`${entry.type}-${index}`} className="flex items-center gap-1">
          {index > 0 && <span className="text-[var(--color-text-tertiary)]">/</span>}
          <button
            onClick={() => onNavigate(index)}
            className={cn(
              'bg-transparent border-none p-0 text-[11px] font-[inherit]',
              index < entries.length - 1
                ? 'cursor-pointer text-[var(--color-accent-primary)] hover:underline'
                : 'cursor-default text-[var(--color-text-secondary)]',
            )}
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
  onOpenResources,
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
        className="workflow-detail-panel-backdrop hidden fixed inset-0 bg-black/40"
        data-testid="workflow-detail-panel-backdrop"
        onClick={onClose}
        style={{ zIndex: 'calc(var(--z-panel) - 1)' as any }}
      />
      <div
        className="workflow-detail-panel fixed top-0 right-0 bottom-0 w-[45%] flex flex-col overflow-y-hidden bg-[var(--color-bg-primary)] font-[var(--font-family)]"
        data-testid="workflow-detail-panel"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          zIndex: 'var(--z-panel)' as any,
          boxShadow: 'var(--shadow-panel)',
        }}
      >
        <header className="px-4 py-3 border-b border-[var(--color-border-subtle)] shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                  {workflow.name}
                </span>
                {workflow.playbookName && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] shrink-0">
                    {workflow.playbookName}
                  </span>
                )}
                {workflow.currentStage && (
                  <span className="text-[10px] text-[var(--color-text-tertiary)] shrink-0">
                    {workflow.currentStage}
                  </span>
                )}
                {isLive && <LiveDot />}
                <PendingActionsBadge count={workflow.pendingActionCount ?? 0} />
              </div>
              <StatusBar workflow={workflow} />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {onOpenResources && (
                <button
                  onClick={onOpenResources}
                  data-testid="open-resources-btn"
                  aria-label="Open resources"
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-transparent border-none cursor-pointer text-[var(--color-text-tertiary)] text-xs leading-none transition-all duration-150 hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]"
                  title="Resources"
                >
                  {/* folder icon via SVG for zero-dependency */}
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
              )}
              <button
                onClick={onClose}
                aria-label="Close panel"
                className="w-7 h-7 flex items-center justify-center rounded-md bg-transparent border-none cursor-pointer text-[var(--color-text-tertiary)] text-lg leading-none transition-all duration-150 hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]"
              >
                ×
              </button>
            </div>
          </div>

          <div className="mt-2">
            <Breadcrumb entries={breadcrumb} onNavigate={onBreadcrumbNavigate} />
          </div>

          <div className="mt-2">
            <DepthDial value={depthLevel} onChange={onDepthChange} />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </>
  );
}
