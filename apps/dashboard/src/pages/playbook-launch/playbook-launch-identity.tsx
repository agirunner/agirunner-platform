import { Link } from 'react-router-dom';

import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import type { LaunchValidationResult } from './playbook-launch-support.js';

export function LaunchPageHeader(props: { selectedPlaybookId: string }): JSX.Element {
  return (
    <div className="space-y-3 rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        <Link to="/design/playbooks" className="underline-offset-4 hover:underline">
          Back to Playbooks
        </Link>
        {props.selectedPlaybookId ? (
          <Link
            to={`/design/playbooks/${props.selectedPlaybookId}`}
            className="underline-offset-4 hover:underline"
          >
            Open Playbook Detail
          </Link>
        ) : null}
      </div>
      <div>
        <h1 className="text-2xl font-semibold">Launch Workflow</h1>
        <p className="text-sm text-muted">
          Start a workflow from a playbook with declared launch inputs and workflow-scoped policy
          overrides.
        </p>
      </div>
    </div>
  );
}

export function RunIdentitySection(props: {
  selectedPlaybookId: string;
  isSelectedPlaybookArchived: boolean;
  launchablePlaybooks: Array<{ id: string; name: string }>;
  workflowName: string;
  workspaceId: string;
  workspaces: Array<{ id: string; name: string }>;
  launchValidation: LaunchValidationResult;
  onPlaybookChange(id: string): void;
  onWorkflowNameChange(name: string): void;
  onWorkspaceChange(id: string): void;
}): JSX.Element {
  return (
    <div className="grid gap-4 rounded-xl border border-border/70 bg-muted/10 p-4">
      <div className="grid gap-1">
        <div className="text-sm font-medium text-foreground">Workflow Basics</div>
        <p className="text-sm text-muted">
          Choose the playbook, name the workflow, and decide whether it belongs to a workspace before
          launch.
        </p>
      </div>

      <label className="grid gap-2 text-sm">
        <span className="font-medium">Playbook</span>
        <Select
          value={props.isSelectedPlaybookArchived ? '__archived__' : props.selectedPlaybookId}
          onValueChange={props.onPlaybookChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a playbook" />
          </SelectTrigger>
          <SelectContent>
            {props.isSelectedPlaybookArchived ? (
              <SelectItem value="__archived__" disabled>
                Inactive playbook selected - save reactivation first
              </SelectItem>
            ) : null}
            {props.launchablePlaybooks.map((playbook) => (
              <SelectItem key={playbook.id} value={playbook.id}>
                {playbook.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {props.launchValidation.fieldErrors.playbook && !props.isSelectedPlaybookArchived ? (
          <p className="text-xs text-red-600 dark:text-red-400">{props.launchValidation.fieldErrors.playbook}</p>
        ) : null}
      </label>
      {props.isSelectedPlaybookArchived ? (
        <div className="rounded-md border border-amber-300 bg-amber-50/80 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          This playbook is inactive. Save a reactivated version from the playbook detail page
          before launching a new workflow.
        </div>
      ) : null}

      <label className="grid gap-2 text-sm">
        <span className="font-medium">Workflow Name</span>
        <Input
          value={props.workflowName}
          onChange={(event) => props.onWorkflowNameChange(event.target.value)}
          placeholder="e.g. Customer onboarding board run"
        />
        {props.launchValidation.fieldErrors.workflowName ? (
          <p className="text-xs text-red-600 dark:text-red-400">
            {props.launchValidation.fieldErrors.workflowName}
          </p>
        ) : (
          <p className="text-xs text-muted">
            Use the workflow name operators will search for in the board and audit trail.
          </p>
        )}
      </label>

      <label className="grid gap-2 text-sm">
        <span className="font-medium">Workspace</span>
        <Select
          value={props.workspaceId || '__none__'}
          onValueChange={(value) => props.onWorkspaceChange(value === '__none__' ? '' : value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Standalone workflow" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Standalone workflow</SelectItem>
            {props.workspaces.map((workspace) => (
              <SelectItem key={workspace.id} value={workspace.id}>
                {workspace.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}
