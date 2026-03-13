import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { SearchableCombobox } from '../../components/log-viewer/ui/searchable-combobox.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { dashboardApi, type DashboardAgentRecord, type DashboardWorkflowRecord } from '../../lib/api.js';
import {
  agentDisplayName,
  buildAgentItems,
  createGrant,
  describeSelectedAgent,
  findAgent,
  GRANT_PERMISSION_OPTIONS,
  sortAgents,
} from './orchestrator-grants-page.support.js';

export function CreateGrantDialog(props: {
  isOpen: boolean;
  onClose(): void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [agentId, setAgentId] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const agentsQuery = useQuery({
    queryKey: ['agent-grant-options'],
    queryFn: () => dashboardApi.listAgents(),
    staleTime: 30_000,
  });
  const workflowsQuery = useQuery({
    queryKey: ['workflow-grant-options'],
    queryFn: () => dashboardApi.listWorkflows(),
  });
  const mutation = useMutation({
    mutationFn: createGrant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orchestrator-grants'] });
      resetAndClose();
    },
  });

  function resetAndClose(): void {
    setAgentId('');
    setWorkflowId('');
    setExpiresAt('');
    setPermissions([]);
    props.onClose();
  }

  function togglePermission(permission: string): void {
    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((value) => value !== permission)
        : [...current, permission],
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!agentId.trim() || !workflowId.trim() || permissions.length === 0) {
      return;
    }
    mutation.mutate({
      agent_id: agentId.trim(),
      workflow_id: workflowId.trim(),
      permissions,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    });
  }

  const agents = sortAgents(agentsQuery.data ?? []);
  const selectedAgent = findAgent(agents, agentId);
  const agentItems = buildAgentItems(agents);
  const canSubmit =
    Boolean(agentId.trim()) &&
    Boolean(workflowId.trim()) &&
    permissions.length > 0 &&
    !mutation.isPending &&
    !agentsQuery.isLoading &&
    !workflowsQuery.isLoading &&
    !agentsQuery.isError &&
    agents.length > 0;

  return (
    <Dialog open={props.isOpen} onOpenChange={(open) => !open && resetAndClose()}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create grant</DialogTitle>
          <DialogDescription>
            Bind an agent to a workflow scope with the minimum permissions needed for orchestration.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <AgentInventoryField
              value={agentId || null}
              agents={agents}
              isLoading={agentsQuery.isLoading}
              hasError={Boolean(agentsQuery.error)}
              onChange={(value) => setAgentId(value ?? '')}
              onRetry={() => void agentsQuery.refetch()}
            />
            <WorkflowScopeField
              value={workflowId}
              workflows={sortWorkflows(workflowsQuery.data?.data ?? [])}
              isLoading={workflowsQuery.isLoading}
              onChange={setWorkflowId}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="grant-expires-at" className="text-sm font-medium">
                Expiry (optional)
              </label>
              <Input
                id="grant-expires-at"
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </div>
            <PermissionField permissions={permissions} onToggle={togglePermission} />
          </div>
          {selectedAgent ? (
            <div className="rounded-xl border border-border/70 bg-border/10 p-4">
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Selected agent</p>
                <p className="text-sm text-muted">{agentDisplayName(selectedAgent)}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {describeSelectedAgent(selectedAgent).map((detail) => (
                    <div
                      key={detail.label}
                      className="rounded-lg border border-border/70 bg-background/80 p-3"
                    >
                      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
                        {detail.label}
                      </p>
                      <p className="mt-1 text-sm text-foreground">{detail.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          {mutation.isError ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Failed to create the grant. Check the selected agent and workflow scope, then retry.</p>
            </div>
          ) : null}
          <div className="flex flex-col gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={resetAndClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {mutation.isPending ? 'Creating…' : 'Create grant'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WorkflowScopeField(props: {
  value: string;
  workflows: DashboardWorkflowRecord[];
  isLoading: boolean;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Workflow scope</label>
      <Select value={props.value} onValueChange={props.onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select workflow" />
        </SelectTrigger>
        <SelectContent>
          {props.isLoading ? (
            <SelectItem value="__loading" disabled>
              Loading workflows…
            </SelectItem>
          ) : props.workflows.length === 0 ? (
            <SelectItem value="__empty" disabled>
              No workflows available
            </SelectItem>
          ) : (
            props.workflows.map((workflow) => (
              <SelectItem key={workflow.id} value={workflow.id}>
                {workflow.name} · {workflow.state}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      <p className="text-xs leading-5 text-muted">
        Scope the grant to the exact workflow that needs orchestration access.
      </p>
    </div>
  );
}

function AgentInventoryField(props: {
  value: string | null;
  agents: DashboardAgentRecord[];
  isLoading: boolean;
  hasError: boolean;
  onChange(value: string | null): void;
  onRetry(): void;
}): JSX.Element {
  const isEmpty = !props.isLoading && !props.hasError && props.agents.length === 0;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Agent</label>
      <SearchableCombobox
        items={buildAgentItems(props.agents)}
        value={props.value}
        onChange={props.onChange}
        placeholder="Select agent"
        searchPlaceholder="Search agents by name, status, worker, or capability"
        allGroupLabel="Registered agents"
        isLoading={props.isLoading}
        disabled={props.isLoading || props.hasError || isEmpty}
      />
      {props.isLoading ? (
        <p className="text-xs leading-5 text-muted">Loading agents from the live inventory…</p>
      ) : null}
      {isEmpty ? (
        <div className="rounded-lg border border-border/70 bg-border/10 p-3 text-sm text-muted">
          No registered agents are available for grants yet. Register or reconnect an agent, then
          reopen this dialog.
        </div>
      ) : null}
      {props.hasError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
          <p>Agent inventory is unavailable right now.</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={props.onRetry}>
            Retry agent inventory
          </Button>
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted">
          Choose a registered agent from the live inventory instead of typing a raw identifier.
        </p>
      )}
    </div>
  );
}

function PermissionField(props: {
  permissions: string[];
  onToggle(permission: string): void;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Permission set</p>
      <div className="flex flex-wrap gap-2">
        {GRANT_PERMISSION_OPTIONS.map((permission) => {
          const isSelected = props.permissions.includes(permission);
          return (
            <Button
              key={permission}
              type="button"
              size="sm"
              variant={isSelected ? 'default' : 'outline'}
              onClick={() => props.onToggle(permission)}
            >
              {permission}
            </Button>
          );
        })}
      </div>
      <p className="text-xs leading-5 text-muted">
        Read grants view posture, write grants adjust state, and execute grants allow action-taking
        orchestration flows.
      </p>
    </div>
  );
}

function sortWorkflows(workflows: DashboardWorkflowRecord[]): DashboardWorkflowRecord[] {
  return [...workflows].sort((left, right) => left.name.localeCompare(right.name));
}
