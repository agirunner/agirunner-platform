import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';

import type { DashboardProjectRecord } from '../../lib/api.js';
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
import { ProjectModelOverridesTab } from './project-model-overrides-tab.js';
import {
  buildProjectSecretPostureSummary,
  buildProjectSettingsPatch,
  buildProjectSettingsSurfaceSummary,
  createProjectSettingsDraft,
  summarizeProjectBrief,
  type ProjectSecretDraft,
  type ProjectSecretMode,
  type ProjectSettingsDraft,
  validateProjectSettingsDraft,
} from './project-settings-support.js';

const EMPTY_BRIEF_SUMMARY = 'No project brief saved yet.';
const SECRET_MODE_OPTIONS: Array<{ value: ProjectSecretMode; label: string }> = [
  { value: 'preserve', label: 'Preserve existing' },
  { value: 'replace', label: 'Replace on save' },
  { value: 'clear', label: 'Clear on save' },
];

type CredentialKey = keyof ProjectSettingsDraft['credentials'];
type SettingsSectionKey = 'basics' | 'repository' | 'credentials' | 'models' | 'brief';

export function ProjectSettingsTab({ project }: { project: DashboardProjectRecord }): JSX.Element {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => createProjectSettingsDraft(project));
  const [expandedCredentialKey, setExpandedCredentialKey] = useState<CredentialKey | null>(null);
  const [expandedSection, setExpandedSection] = useState<SettingsSectionKey | null>(null);
  const validation = validateProjectSettingsDraft(draft);
  const surfaceSummary = buildProjectSettingsSurfaceSummary(project, draft, validation);
  const planningBriefSummary = summarizeProjectBrief(draft.projectBrief);
  const isPlanningBriefEmpty = planningBriefSummary === EMPTY_BRIEF_SUMMARY;
  const mutation = useMutation({
    mutationFn: () => dashboardApi.patchProject(project.id, buildProjectSettingsPatch(project, draft)),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', project.id] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]);
      toast.success('Project settings saved.');
    },
  });

  const basicsSummary = buildBasicsSummary(draft, surfaceSummary.lifecycleLabel);
  const repositorySummary = buildRepositorySummary(draft, surfaceSummary.repositoryLabel);
  const credentialsSummary = `${surfaceSummary.configuredSecretLabel} • ${surfaceSummary.stagedSecretChangeLabel}`;
  const modelSummary =
    surfaceSummary.modelOverrideCount > 0
      ? `${surfaceSummary.modelOverrideLabel} configured`
      : 'Using shared model posture';

  const credentials: Array<{
    key: CredentialKey;
    label: string;
    draft: ProjectSecretDraft;
    error?: string;
    textarea?: boolean;
  }> = [
    {
      key: 'gitToken',
      label: 'Git token',
      draft: draft.credentials.gitToken,
      error: validation.fieldErrors.gitToken,
    },
    {
      key: 'gitSshPrivateKey',
      label: 'SSH private key',
      draft: draft.credentials.gitSshPrivateKey,
      textarea: true,
    },
    {
      key: 'gitSshKnownHosts',
      label: 'SSH known_hosts',
      draft: draft.credentials.gitSshKnownHosts,
      textarea: true,
    },
    {
      key: 'webhookSecret',
      label: 'Webhook secret',
      draft: draft.credentials.webhookSecret,
    },
  ];

  function updateCredential(key: CredentialKey, next: ProjectSecretDraft) {
    setDraft((current) => ({
      ...current,
      credentials: {
        ...current.credentials,
        [key]: next,
      },
    }));
  }

  function toggleSection(section: SettingsSectionKey) {
    setExpandedSection((current) => (current === section ? null : section));
  }

  return (
    <div className="space-y-3">
      <Card className="border-border/70 shadow-none">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{surfaceSummary.lifecycleLabel}</Badge>
                <Badge variant="outline">{surfaceSummary.repositoryLabel}</Badge>
                <Badge variant="outline">{surfaceSummary.configuredSecretLabel}</Badge>
                <Badge variant="outline">{surfaceSummary.modelOverrideLabel}</Badge>
                {surfaceSummary.stagedSecretChangeCount > 0 ? (
                  <Badge variant="secondary">{surfaceSummary.stagedSecretChangeLabel}</Badge>
                ) : null}
                {surfaceSummary.blockingIssueCount > 0 ? (
                  <Badge variant="warning">
                    {surfaceSummary.blockingIssueCount}{' '}
                    {surfaceSummary.blockingIssueCount === 1 ? 'blocker' : 'blockers'}
                  </Badge>
                ) : null}
              </div>
              <p className="text-sm leading-6 text-muted">
                Open only the section you need. Repository configuration stays optional for projects
                without source control.
              </p>
            </div>
            <Button
              className="w-full sm:w-auto"
              disabled={!validation.isValid || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              Save settings
            </Button>
          </div>

          {surfaceSummary.blockingIssueCount > 0 ? (
            <BlockingIssuesPanel title="Resolve before saving" issues={validation.blockingIssues} />
          ) : null}
        </CardContent>
      </Card>

      <SettingsDisclosureSection
        id="project-settings-basics"
        title="Project basics"
        description="Name, slug, description, and delivery eligibility."
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
          <TextAreaField
            label="Description"
            value={draft.description}
            className="min-h-[88px]"
            onChange={(value) => setDraft((current) => ({ ...current, description: value }))}
          />
          <ToggleCard
            label="Active project"
            description="Disable this when the workspace should stay visible for review but stop accepting new work."
            meta={
              draft.isActive
                ? 'Operators can route work here.'
                : 'Operators can review it, but new work should stay elsewhere.'
            }
            checked={draft.isActive}
            onCheckedChange={(checked) => setDraft((current) => ({ ...current, isActive: checked }))}
          />
        </div>
      </SettingsDisclosureSection>

      <SettingsDisclosureSection
        id="project-settings-repository"
        title="Repository & git defaults"
        description="Repository URL, default branch, and author identity stay together."
        summary={repositorySummary}
        actionLabel={expandedSection === 'repository' ? 'Hide defaults' : 'Open defaults'}
        isExpanded={expandedSection === 'repository'}
        onToggle={() => toggleSection('repository')}
      >
        <div className="space-y-3">
          <p className="text-sm leading-6 text-muted">
            Repository optional. Leave this section untouched when the project does not depend on
            source control.
          </p>
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
        </div>
      </SettingsDisclosureSection>

      <SettingsDisclosureSection
        id="project-settings-credentials"
        title="Credentials posture"
        description="Open the posture only when a secret needs work."
        summary={credentialsSummary}
        actionLabel={expandedSection === 'credentials' ? 'Hide credentials' : 'Open credentials'}
        isExpanded={expandedSection === 'credentials'}
        onToggle={() => toggleSection('credentials')}
      >
        <div className="space-y-3">
          <p className="text-sm leading-6 text-muted">
            Stored posture stays visible even when editors stay closed.
          </p>
          <div className="space-y-2">
            {credentials.map((credential) => (
              <SecretDisclosureRow
                key={credential.key}
                label={credential.label}
                draft={credential.draft}
                error={credential.error}
                textarea={credential.textarea}
                isExpanded={expandedCredentialKey === credential.key}
                onToggle={() =>
                  setExpandedCredentialKey((current) =>
                    current === credential.key ? null : credential.key,
                  )
                }
                onChange={(next) => updateCredential(credential.key, next)}
              />
            ))}
          </div>
        </div>
      </SettingsDisclosureSection>

      <SettingsDisclosureSection
        id="project-settings-models"
        title="Models"
        description="Project overrides stay secondary until this project truly needs them."
        summary={modelSummary}
        actionLabel={expandedSection === 'models' ? 'Hide models' : 'Open models'}
        isExpanded={expandedSection === 'models'}
        onToggle={() => toggleSection('models')}
      >
        <ProjectModelOverridesTab project={project} />
      </SettingsDisclosureSection>

      <SettingsDisclosureSection
        id="project-settings-brief"
        title="Planning brief"
        description="Keep long-form project context tucked away until you need to review or revise it."
        summary={planningBriefSummary}
        actionLabel={expandedSection === 'brief' ? 'Hide brief' : 'Open brief'}
        isExpanded={expandedSection === 'brief'}
        onToggle={() => toggleSection('brief')}
      >
        <div className="space-y-3">
          {isPlanningBriefEmpty ? (
            <p className="text-sm leading-6 text-muted">
              No project brief saved yet. Open the editor only when this project needs persistent
              operator context.
            </p>
          ) : null}
          <TextAreaField
            label="Project brief"
            value={draft.projectBrief}
            className="min-h-[112px]"
            onChange={(value) => setDraft((current) => ({ ...current, projectBrief: value }))}
          />
        </div>
      </SettingsDisclosureSection>
    </div>
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
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function SecretDisclosureRow(props: {
  label: string;
  draft: ProjectSecretDraft;
  error?: string;
  textarea?: boolean;
  isExpanded: boolean;
  onToggle(): void;
  onChange(next: ProjectSecretDraft): void;
}): JSX.Element {
  const InputComponent = props.textarea ? Textarea : Input;
  const summary = buildProjectSecretPostureSummary(props.draft);
  const isBodyVisible = props.isExpanded || props.draft.mode === 'replace' || !props.draft.configured;
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
                  mode: value as ProjectSecretMode,
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
                onChange={(event) => props.onChange({ ...props.draft, value: event.target.value })}
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

function buildBasicsSummary(
  draft: ProjectSettingsDraft,
  lifecycleLabel: string,
): string {
  const slugLabel = draft.slug.trim() ? `Slug ${draft.slug.trim()}` : 'Slug required';
  return `${lifecycleLabel} • ${slugLabel}`;
}

function buildRepositorySummary(
  draft: ProjectSettingsDraft,
  repositoryLabel: string,
): string {
  if (!draft.repositoryUrl.trim()) {
    return 'Repository optional';
  }

  const details = [repositoryLabel];
  if (draft.defaultBranch.trim()) {
    details.push(`Branch ${draft.defaultBranch.trim()}`);
  }
  if (draft.gitUserEmail.trim()) {
    details.push('Author identity ready');
  }
  return details.join(' • ');
}
