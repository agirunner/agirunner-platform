import { WorkflowStatusRow } from './workflow-status-row';
import { FleetStatusCard } from './fleet-status-card';
import { LiveFeedCard } from './live-feed-card';
import { CostTicker } from './cost-ticker';
import { EmptyState } from '../../../components/ui/empty-state';

interface Workflow {
  id: string;
  name: string;
  state: string;
  currentStage?: string;
  agentRoles?: string[];
  needsAttention?: boolean;
  gateWaiting?: boolean;
}

interface Worker {
  status: string;
}

interface FeedEvent {
  id: string;
  type: string;
  entityType?: string;
  actorType?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface WarRoomViewProps {
  workflows: Workflow[];
  workers: Worker[];
  events: FeedEvent[];
  spendUsd: number;
  tokenCount: number;
  onSelectWorkflow: (workflowId: string) => void;
}

function attentionRank(workflow: Workflow): number {
  if (workflow.state === 'failed') return 0;
  if (workflow.gateWaiting || workflow.needsAttention) return 1;
  if (workflow.state === 'active') return 2;
  return 3;
}

export function sortWorkflowsByAttention(workflows: Workflow[]): Workflow[] {
  return [...workflows].sort((a, b) => attentionRank(a) - attentionRank(b));
}

export function WarRoomView({
  workflows,
  workers,
  events,
  spendUsd,
  tokenCount,
  onSelectWorkflow,
}: WarRoomViewProps) {
  if (workflows.length === 0) {
    return (
      <EmptyState
        title="No workflows yet"
        message="Launch your first workflow to see it here."
      />
    );
  }

  const sorted = sortWorkflowsByAttention(workflows);

  return (
    <>
      <style>{`
        @media (max-width: 767px) {
          .war-room-layout {
            flex-direction: column !important;
          }
          .war-room-left, .war-room-right {
            flex: none !important;
            width: 100% !important;
          }
        }
      `}</style>
      <div className="war-room-layout" style={{ display: 'flex', gap: '16px' }}>
        <div
          className="war-room-left"
          style={{ flex: '0 0 65%', display: 'flex', flexDirection: 'column', gap: '6px' }}
        >
          {sorted.map(w => (
            <WorkflowStatusRow key={w.id} workflow={w} onClick={onSelectWorkflow} />
          ))}
        </div>

        <div
          className="war-room-right"
          style={{ flex: '0 0 35%', display: 'flex', flexDirection: 'column', gap: '8px' }}
        >
          <FleetStatusCard workers={workers} />
          <LiveFeedCard events={events} />
          <CostTicker spendUsd={spendUsd} tokenCount={tokenCount} />
        </div>
      </div>
    </>
  );
}
