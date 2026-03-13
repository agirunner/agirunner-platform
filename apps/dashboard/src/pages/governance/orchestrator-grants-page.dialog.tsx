import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
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
import { dashboardApi, type DashboardWorkflowRecord } from '../../lib/api.js';
import { createGrant, GRANT_PERMISSION_OPTIONS } from './orchestrator-grants-page.support.js';

export function CreateGrantDialog(props: {
  isOpen: boolean;
  onClose(): void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [agentId, setAgentId] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
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
            <div className="space-y-2">
              <label htmlFor="grant-agent-id" className="text-sm font-medium">
                Agent ID
              </label>
              <Input
                id="grant-agent-id"
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
                placeholder="agent-uuid"
                required
              />
            </div>
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
          {mutation.isError ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Failed to create the grant. Check the agent ID and workflow scope, then retry.</p>
            </div>
          ) : null}
          <div className="flex flex-col gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={resetAndClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
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
