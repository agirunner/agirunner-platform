import { WorkflowStatusRow, type WorkflowStatusRowWorkflow } from './workflow-status-row.js';
import { FleetStatusCard } from './fleet-status-card.js';
import { LiveFeedCard } from './live-feed-card.js';
import { CostTicker } from './cost-ticker.js';
import { EmptyState } from '../../../components/ui/empty-state.js';

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
  workflows: WorkflowStatusRowWorkflow[];
  workers: Worker[];
  events: FeedEvent[];
  spendUsd: number;
  tokenCount: number;
  onSelectWorkflow: (workflowId: string) => void;
}

function attentionRank(workflow: WorkflowStatusRowWorkflow): number {
  if (workflow.state === 'failed') return 0;
  if (workflow.gateWaiting || workflow.needsAttention) return 1;
  if (workflow.state === 'active') return 2;
  return 3;
}

export function sortWorkflowsByAttention(workflows: WorkflowStatusRowWorkflow[]): WorkflowStatusRowWorkflow[] {
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
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex flex-col gap-1.5 lg:flex-[0_0_65%]">
        {sorted.map(w => (
          <WorkflowStatusRow key={w.id} workflow={w} onClick={onSelectWorkflow} />
        ))}
      </div>

      <div className="flex flex-col gap-3 lg:flex-[0_0_35%]">
        <FleetStatusCard workers={workers} />
        <LiveFeedCard events={events} />
        <CostTicker spendUsd={spendUsd} tokenCount={tokenCount} />
      </div>
    </div>
  );
}
