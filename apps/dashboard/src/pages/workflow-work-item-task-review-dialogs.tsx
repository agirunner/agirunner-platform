import type { DashboardAgentRecord } from '../lib/api.js';
import { SearchableCombobox, type ComboboxItem } from '../components/log-viewer/ui/searchable-combobox.js';
import { Button } from '../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.js';
import { Textarea } from '../components/ui/textarea.js';

function sortAgents(agents: DashboardAgentRecord[]): DashboardAgentRecord[] {
  return [...agents].sort((left, right) => agentDisplayName(left).localeCompare(agentDisplayName(right)));
}

function agentDisplayName(agent: DashboardAgentRecord): string {
  return agent.name?.trim() || agent.id;
}

function describeAgent(agent: DashboardAgentRecord): string {
  const parts = [agent.status?.trim() || 'unknown'];
  if (agent.worker_id) {
    parts.push(`worker ${agent.worker_id}`);
  }
  return parts.join(' • ');
}

function buildAgentItems(agents: DashboardAgentRecord[]): ComboboxItem[] {
  return agents.map((agent) => ({
    id: agent.id,
    label: agentDisplayName(agent),
    subtitle: describeAgent(agent),
    status: agent.status === 'active' ? 'active' : agent.status === 'completed' ? 'completed' : agent.status === 'failed' ? 'failed' : 'pending',
  }));
}

export function StepChangesDialog(props: {
  isOpen: boolean;
  state: string;
  taskTitle: string;
  feedback: string;
  isPending: boolean;
  onOpenChange(open: boolean): void;
  onFeedbackChange(value: string): void;
  onReject(): void;
  onRequestChanges(): void;
}): JSX.Element {
  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[75vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {props.state === 'failed' ? 'Rework Step' : 'Request Step Changes'}
          </DialogTitle>
          <DialogDescription>
            Keep review feedback attached to &ldquo;{props.taskTitle}&rdquo; without expanding the
            selected work-item panel inline.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Textarea
            value={props.feedback}
            onChange={(event) => props.onFeedbackChange(event.target.value)}
            placeholder="Describe the operator changes needed..."
            rows={4}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={props.isPending}
            >
              Cancel
            </Button>
            {props.state === 'failed' ? (
              <Button
                onClick={props.onRequestChanges}
                disabled={!props.feedback.trim() || props.isPending}
              >
                Rework Step
              </Button>
            ) : (
              <>
                <Button
                  variant="destructive"
                  onClick={props.onReject}
                  disabled={!props.feedback.trim() || props.isPending}
                >
                  Reject Step
                </Button>
                <Button
                  onClick={props.onRequestChanges}
                  disabled={!props.feedback.trim() || props.isPending}
                >
                  Request Changes
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function StepEscalationDialog(props: {
  isOpen: boolean;
  taskTitle: string;
  instructions: string;
  isPending: boolean;
  onOpenChange(open: boolean): void;
  onInstructionsChange(value: string): void;
  onSubmit(): void;
}): JSX.Element {
  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[75vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Provide Operator Guidance</DialogTitle>
          <DialogDescription>
            Resume &ldquo;{props.taskTitle}&rdquo; from the selected work-item flow so the operator
            guidance stays attached to the right board context.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Textarea
            value={props.instructions}
            onChange={(event) => props.onInstructionsChange(event.target.value)}
            placeholder="Describe the operator guidance needed to resume this step..."
            rows={4}
          />
          <p className="text-xs leading-5 text-muted">
            This keeps escalation review in a focused dialog instead of turning the task action row
            into another long inline form.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={props.isPending}
            >
              Close
            </Button>
            <Button
              onClick={props.onSubmit}
              disabled={!props.instructions.trim() || props.isPending}
            >
              Provide Operator Guidance
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WorkItemReassignDialog(props: {
  isOpen: boolean;
  taskTitle: string;
  agents: DashboardAgentRecord[];
  selectedAgentId: string | null;
  reason: string;
  isLoadingAgents: boolean;
  isPending: boolean;
  onOpenChange(open: boolean): void;
  onAgentChange(value: string | null): void;
  onReasonChange(value: string): void;
  onSubmit(): void;
}): JSX.Element {
  const agents = sortAgents(props.agents);
  const agentItems = buildAgentItems(agents);
  const selectedAgent = agents.find((agent) => agent.id === props.selectedAgentId) ?? null;
  const canSubmit = Boolean(props.selectedAgentId?.trim()) && Boolean(props.reason.trim()) && !props.isPending;

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[75vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reassign Step</DialogTitle>
          <DialogDescription>
            Move &ldquo;{props.taskTitle}&rdquo; to a different agent without leaving the selected
            work-item flow.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className="text-sm font-medium">Target agent</div>
            <SearchableCombobox
              value={props.selectedAgentId}
              onChange={props.onAgentChange}
              items={agentItems}
              placeholder="Choose an agent"
              searchPlaceholder="Search agents by name, worker, or status"
              allGroupLabel="All agents"
              isLoading={props.isLoadingAgents}
            />
            <p className="text-xs leading-5 text-muted">
              Reassignments follow the selected agent and preserve the work-item scope.
            </p>
          </div>
          <Textarea
            value={props.reason}
            onChange={(event) => props.onReasonChange(event.target.value)}
            placeholder="Explain why this step should move to another agent..."
            rows={4}
          />
          {selectedAgent ? (
            <p className="text-xs leading-5 text-muted">
              Selected agent: {agentDisplayName(selectedAgent)}
              {selectedAgent.worker_id ? ` • worker ${selectedAgent.worker_id}` : ''}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={props.isPending}
            >
              Cancel
            </Button>
            <Button onClick={props.onSubmit} disabled={!canSubmit}>
              Reassign Step
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
