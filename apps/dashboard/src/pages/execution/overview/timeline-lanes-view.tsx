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
    <div style={{
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      backgroundColor: LEGEND_COLORS[status],
      flexShrink: 0,
    }} />
  );
}

function Legend(): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      gap: '16px',
      flexWrap: 'wrap',
      padding: '8px 0',
      borderTop: '1px solid var(--color-border-default)',
      marginTop: '8px',
    }}>
      {LEGEND_ITEMS.map(({ status, label }) => (
        <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <LegendDot status={status} />
          <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

function LaneName({ name }: { name: string }): JSX.Element {
  return (
    <div style={{
      width: '120px',
      flexShrink: 0,
      fontSize: '12px',
      fontWeight: 500,
      color: 'var(--color-text-secondary)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      paddingRight: '8px',
    }}
      title={name}
    >
      {name}
    </div>
  );
}

function LaneRow({ lane, onSelectStage }: { lane: WorkflowLane; onSelectStage: TimelineLanesViewProps['onSelectStage'] }): JSX.Element {
  return (
    <>
      <style>{`
        @media (max-width: 767px) {
          .timeline-lane-row {
            flex-direction: column !important;
            align-items: flex-start !important;
          }
          .timeline-lane-name {
            width: auto !important;
            padding-right: 0 !important;
            padding-bottom: 6px !important;
          }
          .timeline-lane-stages {
            flex-direction: column !important;
            width: 100% !important;
          }
          .timeline-lane-stages > div {
            min-width: auto !important;
            width: 100% !important;
          }
        }
      `}</style>
      <div
        className="timeline-lane-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 0',
          borderBottom: '1px solid var(--color-border-default)',
        }}
      >
        <div className="timeline-lane-name">
          <LaneName name={lane.name} />
        </div>

        <div
          className="timeline-lane-stages"
          style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}
        >
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
    </>
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
    <div>
      {lanes.map((lane) => (
        <LaneRow key={lane.id} lane={lane} onSelectStage={onSelectStage} />
      ))}
      <Legend />
    </div>
  );
}
