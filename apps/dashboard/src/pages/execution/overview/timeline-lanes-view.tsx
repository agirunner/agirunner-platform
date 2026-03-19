import { TimelineStageCell, StageCellStatus } from './timeline-stage-cell.js';
import { EmptyState } from '../../../components/ui/empty-state.js';

export interface WorkflowLane {
  id: string;
  name: string;
  stages: Array<{
    name: string;
    status: StageCellStatus;
    agentRoles?: string[];
  }>;
}

export interface TimelineLanesViewProps {
  lanes: WorkflowLane[];
  onSelectStage: (workflowId: string, stageName: string) => void;
}

const LEGEND_ITEMS: Array<{ status: StageCellStatus; label: string }> = [
  { status: 'completed', label: 'Completed' },
  { status: 'active', label: 'Active' },
  { status: 'waiting', label: 'Waiting' },
  { status: 'failed', label: 'Failed' },
  { status: 'pending', label: 'Pending' },
];

const LEGEND_COLORS: Record<StageCellStatus, string> = {
  completed: 'rgba(34,197,94,0.8)',
  active: 'var(--color-accent-primary)',
  waiting: 'var(--color-status-warning)',
  failed: 'var(--color-status-error)',
  pending: 'var(--color-border-default)',
};

function LegendDot({ status }: { status: StageCellStatus }): JSX.Element {
  return (
    <div
      className="w-2 h-2 rounded-full shrink-0"
      style={{ backgroundColor: LEGEND_COLORS[status] }}
    />
  );
}

function Legend(): JSX.Element {
  return (
    <div className="flex gap-4 flex-wrap pt-3 mt-3 border-t border-[var(--color-border-default)]">
      {LEGEND_ITEMS.map(({ status, label }) => (
        <div key={status} className="flex items-center gap-1.5">
          <LegendDot status={status} />
          <span className="text-[11px] text-[var(--color-text-tertiary)]">{label}</span>
        </div>
      ))}
    </div>
  );
}

function LaneName({ name }: { name: string }): JSX.Element {
  return (
    <div
      className="w-[200px] shrink-0 text-xs font-medium text-[var(--color-text-secondary)] truncate pr-2"
      title={name}
    >
      {name}
    </div>
  );
}

function LaneRow({ lane, onSelectStage }: { lane: WorkflowLane; onSelectStage: TimelineLanesViewProps['onSelectStage'] }): JSX.Element {
  return (
    <div className="flex items-center gap-2 py-2 border-b border-[var(--color-border-default)] max-sm:flex-col max-sm:items-start">
      <LaneName name={lane.name} />

      <div className="flex gap-1.5 flex-wrap max-sm:flex-col max-sm:w-full">
        {lane.stages.map((stage) => (
          <TimelineStageCell
            key={stage.name}
            status={stage.status}
            stageName={stage.name}
            agentRoles={stage.agentRoles}
            onClick={() => onSelectStage(lane.id, stage.name)}
          />
        ))}
      </div>
    </div>
  );
}

export function TimelineLanesView({ lanes, onSelectStage }: TimelineLanesViewProps): JSX.Element {
  if (lanes.length === 0) {
    return (
      <EmptyState
        title="No workflows yet"
        message="Start a workflow to see its timeline here."
      />
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-4">
      {lanes.map((lane) => (
        <LaneRow key={lane.id} lane={lane} onSelectStage={onSelectStage} />
      ))}
      <Legend />
    </div>
  );
}
