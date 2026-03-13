import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/badge.js';
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
        <Link to="/config/playbooks" className="underline-offset-4 hover:underline">
          Back to Playbooks
        </Link>
        {props.selectedPlaybookId ? (
          <Link
            to={`/config/playbooks/${props.selectedPlaybookId}`}
            className="underline-offset-4 hover:underline"
          >
            Open Playbook Detail
          </Link>
        ) : null}
      </div>
      <div>
        <h1 className="text-2xl font-semibold">Launch Playbook</h1>
        <p className="text-sm text-muted">
          Create a new workflow run from a playbook with structured run inputs, board-aware context, and role-based model overrides.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">Structured launch flow</Badge>
        <Badge variant="outline">Board-aware context</Badge>
        <Badge variant="outline">Role-based model policy</Badge>
      </div>
    </div>
  );
}

export function RunIdentitySection(props: {
  selectedPlaybookId: string;
  isSelectedPlaybookArchived: boolean;
  launchablePlaybooks: Array<{ id: string; name: string }>;
  workflowName: string;
  projectId: string;
  projects: Array<{ id: string; name: string }>;
  launchValidation: LaunchValidationResult;
  onPlaybookChange(id: string): void;
  onWorkflowNameChange(name: string): void;
  onProjectChange(id: string): void;
}): JSX.Element {
  return (
    <div className="grid gap-4 rounded-xl border border-border/70 bg-muted/10 p-4">
      <div className="grid gap-1">
        <div className="text-sm font-medium text-foreground">Run Identity</div>
        <p className="text-sm text-muted">
          Choose the playbook, name the run, and decide whether it belongs to a project before
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
                Archived revision selected - restore first
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
          This playbook revision is archived. Restore it from the playbook detail page before
          launching a new workflow.
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
            Use the run name operators will search for in the workflow board and audit trail.
          </p>
        )}
      </label>

      <label className="grid gap-2 text-sm">
        <span className="font-medium">Project</span>
        <Select
          value={props.projectId || '__none__'}
          onValueChange={(value) => props.onProjectChange(value === '__none__' ? '' : value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Standalone workflow" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Standalone workflow</SelectItem>
            {props.projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}
