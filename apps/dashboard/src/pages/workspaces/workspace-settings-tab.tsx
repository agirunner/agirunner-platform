import { useState, type ChangeEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Save } from 'lucide-react';

import type { DashboardWorkspaceRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import { ToggleCard } from '../../components/ui/toggle-card.js';
import { dashboardApi } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { cn } from '../../lib/utils.js';
import { DeleteWorkspaceDialog } from './workspace-list-page.dialogs.js';
import type { WorkspaceOverview } from './workspace-detail-support.js';
import { WorkspaceSettingsShell } from './workspace-settings-shell.js';
import {
  buildWorkspaceSecretPostureSummary,
  buildWorkspaceSettingsPatch,
  buildWorkspaceSettingsSurfaceSummary,
  createWorkspaceSettingsDraft,
  type WorkspaceSecretDraft,
  type WorkspaceSecretMode,
  type WorkspaceSettingsDraft,
  validateWorkspaceSettingsDraft,
} from './workspace-settings-support.js';

const SECRET_MODE_OPTIONS: Array<{ value: WorkspaceSecretMode; label: string }> = [
  { value: 'preserve', label: 'Preserve existing' },
  { value: 'replace', label: 'Replace on save' },
  { value: 'clear', label: 'Clear on save' },
];

const STORAGE_OPTIONS = [
  { value: 'git_remote', label: 'Git Remote' },
  { value: 'host_directory', label: 'Host Directory' },
  { value: 'workspace_artifacts', label: 'Workspace Artifacts' },
] as const;

type SettingsSectionKey = 'basics' | 'storage' | 'danger';

export function WorkspaceSettingsTab(props: {
  workspace: DashboardWorkspaceRecord;
  overview: WorkspaceOverview;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => createWorkspaceSettingsDraft(props.workspace));
  const [showDelete, setShowDelete] = useState(false);
  const [isGitTokenExpanded, setGitTokenExpanded] = useState(false);
  const [expandedSection, setExpandedSection] = useState<SettingsSectionKey | null>(null);
  const validation = validateWorkspaceSettingsDraft(draft);
  const surfaceSummary = buildWorkspaceSettingsSurfaceSummary(props.workspace, draft, validation);
  const mutation = useMutation({
    mutationFn: () =>
      dashboardApi.patchWorkspace(props.workspace.id, buildWorkspaceSettingsPatch(props.workspace, draft)),
    onSuccess: async (updatedWorkspace) => {
      setDraft(createWorkspaceSettingsDraft(updatedWorkspace));
      setGitTokenExpanded(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workspace', props.workspace.id] }),
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
      ]);
      toast.success('Workspace settings saved.');
    },
  });

  const basicsSummary = buildBasicsSummary(draft);
  const storageSummary = buildStorageSummary(draft, surfaceSummary.storageLabel);

  function toggleSection(section: SettingsSectionKey) {
    setExpandedSection((current) => (current === section ? null : section));
  }

  return (
    <>
      <WorkspaceSettingsShell
        workspace={props.workspace}
        overview={props.overview}
        headerAction={
          <Button
            size="sm"
            disabled={!validation.isValid || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            <Save className="h-4 w-4" />
            Save settings
          </Button>
        }
      >
      <Card className="border-border/70 shadow-none">
        <CardContent className="space-y-3 p-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{surfaceSummary.lifecycleLabel}</Badge>
              <Badge variant="outline">{surfaceSummary.storageLabel}</Badge>
              {surfaceSummary.blockingIssueCount > 0 ? (
                <Badge variant="warning">
                  {surfaceSummary.blockingIssueCount}{' '}
                  {surfaceSummary.blockingIssueCount === 1 ? 'blocker' : 'blockers'}
                </Badge>
              ) : null}
            </div>
            <p className="text-sm leading-6 text-muted">
              Open only the section you need. Storage is explicit at the workspace level and lower-level
              repo or path overrides are not used.
            </p>
          </div>

          {surfaceSummary.blockingIssueCount > 0 ? (
            <BlockingIssuesPanel title="Resolve Before Saving" issues={validation.blockingIssues} />
          ) : null}

          <ToggleCard
            label="Workspace Lifecycle"
            description={
              draft.isActive
                ? 'Active workspaces can receive new work.'
                : 'Inactive workspaces stay available for review without receiving new work.'
            }
            checked={draft.isActive}
            checkedLabel="Active"
            uncheckedLabel="Inactive"
            onCheckedChange={(checked) => setDraft((current) => ({ ...current, isActive: checked }))}
          />
        </CardContent>
      </Card>

      <SettingsDisclosureSection
        id="workspace-settings-basics"
        title="Workspace Basics"
        description="Name and slug."
        summary={basicsSummary}
        actionLabel={expandedSection === 'basics' ? 'Hide basics' : 'Open basics'}
        isExpanded={expandedSection === 'basics'}
        onToggle={() => toggleSection('basics')}
      >
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label="Name"
              value={draft.name}
              error={validation.fieldErrors.name}
              onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
            />
            <TextField
              label="Slug"
              value={draft.slug}
              error={validation.fieldErrors.slug}
              onChange={(value) => setDraft((current) => ({ ...current, slug: value }))}
            />
          </div>
        </div>
      </SettingsDisclosureSection>

      <SettingsDisclosureSection
        id="workspace-settings-storage"
        title="Workspace Storage"
        description="Choose the workspace storage type and configure only the fields that apply to it."
        summary={storageSummary}
        actionLabel={expandedSection === 'storage' ? 'Hide storage' : 'Open storage'}
        isExpanded={expandedSection === 'storage'}
        onToggle={() => toggleSection('storage')}
      >
        <div className="space-y-3">
          <label className="grid gap-1.5 text-sm sm:max-w-[240px]">
            <span className="font-medium">Storage type</span>
            <Select
              value={draft.storageType}
              onValueChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  storageType: value as WorkspaceSettingsDraft['storageType'],
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STORAGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {draft.storageType === 'git_remote' ? (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <TextField
                  label="Repository URL"
                  value={draft.repositoryUrl}
                  error={validation.fieldErrors.repositoryUrl}
                  onChange={(value) => setDraft((current) => ({ ...current, repositoryUrl: value }))}
                />
                <TextField
                  label="Default branch"
                  value={draft.defaultBranch}
                  onChange={(value) => setDraft((current) => ({ ...current, defaultBranch: value }))}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <TextField
                  label="Git user name"
                  value={draft.gitUserName}
                  onChange={(value) => setDraft((current) => ({ ...current, gitUserName: value }))}
                />
                <TextField
                  label="Git user email"
                  value={draft.gitUserEmail}
                  error={validation.fieldErrors.gitUserEmail}
                  onChange={(value) => setDraft((current) => ({ ...current, gitUserEmail: value }))}
                />
              </div>
              <div className="space-y-2">
                <SecretDisclosureRow
                  label="Git token"
                  draft={draft.credentials.gitToken}
                  error={validation.fieldErrors.gitToken}
                  isExpanded={isGitTokenExpanded}
                  onToggle={() => setGitTokenExpanded((current) => !current)}
                  onChange={(next) =>
                    setDraft((current) => ({
                      ...current,
                      credentials: {
                        ...current.credentials,
                        gitToken: next,
                      },
                    }))
                  }
                />
              </div>
            </div>
          ) : null}

          {draft.storageType === 'host_directory' ? (
            <div className="space-y-3">
              <TextField
                label="Host path"
                value={draft.hostPath}
                error={validation.fieldErrors.hostPath}
                onChange={(value) => setDraft((current) => ({ ...current, hostPath: value }))}
              />
              <p className="text-sm leading-6 text-muted">
                The path must already exist. All runtimes are expected to mount the same path. Writes
                happen as the task container user, which is currently `root`.
              </p>
              <ToggleCard
                label="Read-only mount"
                description="Mount this path read-only for task runs."
                checked={draft.readOnly}
                checkedLabel="Read-only"
                uncheckedLabel="Read-write"
                onCheckedChange={(checked) => setDraft((current) => ({ ...current, readOnly: checked }))}
              />
            </div>
          ) : null}

          {draft.storageType === 'workspace_artifacts' ? (
            <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-sm leading-6 text-muted">
              Artifacts upload from the Knowledge tab. Stored artifacts appear in task context and do
              not restore into the working directory automatically.
            </div>
          ) : null}
        </div>
      </SettingsDisclosureSection>
      <SettingsDisclosureSection
        id="workspace-settings-danger"
        title="Danger"
        description="Delete this workspace only when the workspace should be removed permanently for this tenant."
        summary="Workspace deletion is destructive. Leave this closed unless you intentionally need to remove the workspace."
        actionLabel={expandedSection === 'danger' ? 'Hide danger' : 'Open danger'}
        isExpanded={expandedSection === 'danger'}
        onToggle={() => toggleSection('danger')}
      >
        <div className="space-y-3">
          <p className="text-sm leading-6 text-muted">
            Delete this workspace only when the workspace should be removed permanently for this tenant.
          </p>
          <Button variant="destructive" type="button" onClick={() => setShowDelete(true)}>
            Delete workspace
          </Button>
        </div>
      </SettingsDisclosureSection>
      </WorkspaceSettingsShell>
      {showDelete ? (
        <DeleteWorkspaceDialog workspace={props.workspace} onClose={() => setShowDelete(false)} />
      ) : null}
    </>
  );
}

function SettingsDisclosureSection(props: {
  id: string;
  title: string;
  description: string;
  summary: string;
  actionLabel: string;
  isExpanded: boolean;
  onToggle(): void;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card id={props.id} className="border-border/70 shadow-none">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left"
        aria-expanded={props.isExpanded}
        onClick={props.onToggle}
      >
        <div className="space-y-1.5">
          <div className="text-base font-semibold text-foreground">{props.title}</div>
          <p className="text-sm leading-6 text-muted">{props.description}</p>
          <p className="max-w-3xl text-sm leading-5 text-muted">{props.summary}</p>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-xs font-medium text-muted">{props.actionLabel}</span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted transition-transform',
              props.isExpanded && 'rotate-180',
            )}
          />
        </div>
      </button>
      {props.isExpanded ? (
        <CardContent className="border-t border-border/70 p-4 pt-4">{props.children}</CardContent>
      ) : null}
    </Card>
  );
}

function TextField(props: {
  label: string;
  value: string;
  error?: string;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{props.label}</span>
      <Input
        value={props.value}
        aria-invalid={props.error ? true : undefined}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <FieldMessage message={props.error} />
    </label>
  );
}

function TextAreaField(props: {
  label: string;
  value: string;
  className?: string;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{props.label}</span>
      <Textarea
        value={props.value}
        className={cn('min-h-[96px]', props.className)}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function SecretDisclosureRow(props: {
  label: string;
  draft: WorkspaceSecretDraft;
  error?: string;
  textarea?: boolean;
  isExpanded: boolean;
  onToggle(): void;
  onChange(next: WorkspaceSecretDraft): void;
}): JSX.Element {
  const InputComponent = props.textarea ? Textarea : Input;
  const summary = buildWorkspaceSecretPostureSummary(props.draft);
  const isBodyVisible = props.isExpanded || props.draft.mode === 'replace';
  const actionLabel = props.draft.configured
    ? props.isExpanded
      ? 'Hide secret'
      : 'Edit secret'
    : props.isExpanded
      ? 'Hide setup'
      : 'Set up secret';

  return (
    <div className="rounded-xl border border-border/70 bg-background/70">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-3.5 py-3 text-left"
        aria-expanded={isBodyVisible}
        onClick={props.onToggle}
      >
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-foreground">{props.label}</div>
            <Badge variant={props.draft.configured ? 'secondary' : 'outline'}>
              {summary.statusLabel}
            </Badge>
            <Badge variant={summary.tone === 'warning' ? 'warning' : 'outline'}>
              {summary.postureLabel}
            </Badge>
          </div>
          <p className="text-sm leading-6 text-muted">{summary.detail}</p>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-xs font-medium text-muted">{actionLabel}</span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted transition-transform',
              isBodyVisible && 'rotate-180',
            )}
          />
        </div>
      </button>

      {isBodyVisible ? (
        <div className="space-y-3 border-t border-border/70 px-3.5 py-3">
          <label className="grid gap-1.5 text-xs sm:max-w-[220px]">
            <span className="font-medium text-muted">Secret posture</span>
            <Select
              value={props.draft.mode}
              onValueChange={(value) =>
                props.onChange({
                  ...props.draft,
                  mode: value as WorkspaceSecretMode,
                  value: value === 'clear' ? '' : props.draft.value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECRET_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {props.draft.mode === 'replace' ? (
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">New value</span>
              <InputComponent
                value={props.draft.value}
                aria-invalid={props.error ? true : undefined}
                className={props.textarea ? 'min-h-[96px]' : undefined}
                onChange={(
                  event: ChangeEvent<HTMLInputElement> | ChangeEvent<HTMLTextAreaElement>,
                ) => props.onChange({ ...props.draft, value: event.target.value })}
              />
              <FieldMessage message={props.error} />
            </label>
          ) : props.draft.mode === 'clear' ? (
            <p className="text-xs leading-5 text-muted">Stored value will be cleared when you save.</p>
          ) : !props.draft.configured ? (
            <p className="text-xs leading-5 text-muted">
              Choose Replace on save when you are ready to add this secret.
            </p>
          ) : (
            <p className="text-xs leading-5 text-muted">Stored value will stay unchanged.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function BlockingIssuesPanel(props: { title: string; issues: string[] }): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="warning">Attention</Badge>
        <p className="text-sm font-medium text-foreground">{props.title}</p>
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground">
        {props.issues.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
    </div>
  );
}

function FieldMessage(props: { message?: string }): JSX.Element | null {
  if (!props.message) {
    return null;
  }

  return <p className="text-xs text-amber-900 dark:text-amber-100">{props.message}</p>;
}

function buildBasicsSummary(draft: WorkspaceSettingsDraft): string {
  const slugLabel = draft.slug.trim() ? `Slug ${draft.slug.trim()}` : 'Slug required';
  return slugLabel;
}

function buildStorageSummary(
  draft: WorkspaceSettingsDraft,
  storageLabel: string,
): string {
  if (draft.storageType === 'host_directory') {
    if (!draft.hostPath.trim()) {
      return `${storageLabel} • Path required`;
    }
    return `${storageLabel} • ${draft.hostPath.trim()} • ${draft.readOnly ? 'Read-only' : 'Read-write'}`;
  }
  if (draft.storageType === 'workspace_artifacts') {
    return `${storageLabel} • Explicit artifact persistence`;
  }

  const gitTokenSummary = buildWorkspaceSecretPostureSummary(draft.credentials.gitToken);
  if (!draft.repositoryUrl.trim()) {
    return `${storageLabel} • Repository required`;
  }

  const details = [storageLabel, draft.repositoryUrl.trim()];
  if (draft.defaultBranch.trim()) {
    details.push(`Branch ${draft.defaultBranch.trim()}`);
  }
  if (draft.gitUserEmail.trim()) {
    details.push('Author identity ready');
  }
  details.push(`Git token ${gitTokenSummary.postureLabel.toLowerCase()}`);
  return details.join(' • ');
}
