import { InlineActionButtons } from './inline-action-buttons.js';

interface PendingGate {
  id: string;
  stageName: string;
}

interface TaskEntry {
  id: string;
  title: string;
  state: string;
}

interface WorkflowSummary {
  id: string;
  name: string;
  state: string;
}

export interface CommandCenterDrawerProps {
  workflow: WorkflowSummary;
  pendingGates: PendingGate[];
  tasks: TaskEntry[];
  onAction: (entityType: string, entityId: string, action: string) => void;
  onClose: () => void;
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: '11px',
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'var(--color-text-tertiary)',
      padding: '12px 16px 6px',
    }}>
      {title}
    </div>
  );
}

function LifecycleSection({
  workflow,
  onAction,
}: {
  workflow: WorkflowSummary;
  onAction: (action: string) => void;
}) {
  return (
    <div data-testid="lifecycle-section">
      <SectionHeader title="Lifecycle Controls" />
      <div style={{ padding: '4px 16px 12px' }}>
        <InlineActionButtons
          entityType="workflow"
          entityState={workflow.state}
          onAction={onAction}
        />
      </div>
    </div>
  );
}

function GatesSection({
  gates,
  onAction,
}: {
  gates: PendingGate[];
  onAction: (gateId: string, action: string) => void;
}) {
  if (gates.length === 0) return null;

  return (
    <div data-testid="gates-section">
      <SectionHeader title="Pending Gates" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 16px 12px' }}>
        {gates.map(gate => (
          <div key={gate.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {gate.stageName}
            </span>
            <InlineActionButtons
              entityType="gate"
              entityState="requested"
              onAction={(action) => onAction(gate.id, action)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function TasksSection({
  tasks,
  onAction,
}: {
  tasks: TaskEntry[];
  onAction: (taskId: string, action: string) => void;
}) {
  const actionableTasks = tasks.filter(t => t.state === 'active' || t.state === 'failed');

  if (actionableTasks.length === 0) return null;

  return (
    <div data-testid="tasks-section">
      <SectionHeader title="Active Tasks" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 16px 12px' }}>
        {actionableTasks.map(task => (
          <div key={task.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {task.title}
            </span>
            <InlineActionButtons
              entityType="task"
              entityState={task.state}
              onAction={(action) => onAction(task.id, action)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CommandCenterDrawer({
  workflow,
  pendingGates,
  tasks,
  onAction,
  onClose,
}: CommandCenterDrawerProps): JSX.Element {
  return (
    <>
      <style>{`
        @media (max-width: 767px) {
          .command-center-drawer {
            width: 100% !important;
          }
        }
      `}</style>
      <div
        className="command-center-drawer"
        data-testid="command-center-drawer"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '360px',
          zIndex: 'var(--z-drawer)' as unknown as number,
          boxShadow: 'var(--shadow-panel)',
          backgroundColor: 'var(--color-bg-primary)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'var(--font-family)',
          overflowY: 'hidden',
          borderLeft: '1px solid var(--color-border-subtle)',
        }}
      >
        <header style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {workflow.name}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>
              Command Center
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
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
        </header>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <LifecycleSection
            workflow={workflow}
            onAction={(action) => onAction('workflow', workflow.id, action)}
          />
          <GatesSection
            gates={pendingGates}
            onAction={(gateId, action) => onAction('gate', gateId, action)}
          />
          <TasksSection
            tasks={tasks}
            onAction={(taskId, action) => onAction('task', taskId, action)}
          />
        </div>
      </div>
    </>
  );
}
