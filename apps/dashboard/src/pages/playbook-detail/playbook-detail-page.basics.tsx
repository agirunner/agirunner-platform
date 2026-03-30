import { Link } from 'react-router-dom';
import { Save } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Switch } from '../../components/ui/switch.js';
import { Textarea } from '../../components/ui/textarea.js';
import type { DashboardPlaybookRecord } from '../../lib/api.js';
import { buildWorkflowsLaunchHref } from '../workflows/workflows-page.support.js';
import {
  describePlaybookLifecycle,
  formatDate,
  lifecycleOptions,
  type PlaybookLifecycle,
} from './playbook-detail-page.controller.js';

export function PlaybookDetailHero(props: {
  canSave: boolean;
  isActive: boolean;
  message: string | null;
  onSave(): void;
  playbook: DashboardPlaybookRecord;
}): JSX.Element {
  return (
    <>
      {!props.isActive ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          This playbook is staged as inactive. Save the page to stop new workflow launches for this
          family while keeping revision history available.
        </div>
      ) : null}
      {props.message ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
          {props.message}
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{props.playbook.name}</h1>
            <Badge variant="outline">v{props.playbook.version}</Badge>
            <Badge variant="secondary">
              {describePlaybookLifecycle(props.playbook.lifecycle)}
            </Badge>
            {!props.playbook.is_active ? <Badge variant="secondary">Inactive</Badge> : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Created</span>
              <span>{formatDate(props.playbook.created_at)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Updated</span>
              <span>{formatDate(props.playbook.updated_at)}</span>
            </div>
          </div>
          <p className="max-w-full overflow-x-auto whitespace-nowrap text-sm text-muted">
            Edit the playbook definition, workflow guidance, and workflow goals for this revision.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {props.playbook.is_active ? (
            <Button asChild variant="outline">
              <Link to={buildWorkflowsLaunchHref({ playbookId: props.playbook.id })}>Launch</Link>
            </Button>
          ) : null}
          <Button onClick={props.onSave} disabled={!props.canSave}>
            <Save className="h-4 w-4" />
            Save Playbook
          </Button>
        </div>
      </div>
    </>
  );
}

export function PlaybookDetailBasicsCard(props: {
  basicValidation: {
    fieldErrors: {
      name?: string;
      outcome?: string;
    };
  };
  hasAttemptedSave: boolean;
  isActive: boolean;
  lifecycle: PlaybookLifecycle;
  name: string;
  onActiveChange(nextValue: boolean): void;
  onLifecycleChange(nextValue: PlaybookLifecycle): void;
  onNameChange(nextValue: string): void;
  onOutcomeChange(nextValue: string): void;
  onSlugChange(nextValue: string): void;
  outcome: string;
  slug: string;
}): JSX.Element {
  return (
    <Card id="playbook-identity">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle>Playbook Basics</CardTitle>
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            <span className="text-xs font-medium text-muted">
              {props.isActive ? 'Active' : 'Inactive'}
            </span>
            <Switch
              checked={props.isActive}
              aria-label="Playbook active"
              onCheckedChange={props.onActiveChange}
            />
          </div>
        </div>
        <p className="text-sm text-muted">
          Set the core playbook identity, outcome, and lifecycle for this revision.
        </p>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)] lg:items-stretch">
          <div className="grid gap-4">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Name</span>
              <Input
                value={props.name}
                onChange={(event) => props.onNameChange(event.target.value)}
                aria-invalid={Boolean(
                  props.hasAttemptedSave && props.basicValidation.fieldErrors.name,
                )}
              />
              {props.hasAttemptedSave && props.basicValidation.fieldErrors.name ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {props.basicValidation.fieldErrors.name}
                </p>
              ) : null}
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Slug</span>
              <Input
                value={props.slug}
                onChange={(event) => props.onSlugChange(event.target.value)}
              />
            </label>
            <div className="grid gap-2 text-sm">
              <span className="font-medium">Lifecycle</span>
              <Select
                value={props.lifecycle}
                onValueChange={(value) =>
                  props.onLifecycleChange(value as PlaybookLifecycle)
                }
              >
                <SelectTrigger aria-label="Playbook lifecycle">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {lifecycleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted">
                {lifecycleOptions.find((option) => option.value === props.lifecycle)?.description}
              </p>
            </div>
          </div>
          <div className="grid gap-2 text-sm lg:grid-rows-[auto_minmax(0,1fr)]">
            <span className="font-medium">Outcome</span>
            <Textarea
              value={props.outcome}
              onChange={(event) => props.onOutcomeChange(event.target.value)}
              className="min-h-[220px] h-full lg:min-h-0"
              aria-invalid={Boolean(
                props.hasAttemptedSave && props.basicValidation.fieldErrors.outcome,
              )}
            />
            {props.hasAttemptedSave && props.basicValidation.fieldErrors.outcome ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                {props.basicValidation.fieldErrors.outcome}
              </p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
