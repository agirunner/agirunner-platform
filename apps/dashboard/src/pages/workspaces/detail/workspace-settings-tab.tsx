import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';

import type { DashboardWorkspaceRecord } from '../../../lib/api.js';
import { Button } from '../../../components/ui/button.js';
import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../../components/forms/form-feedback.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.js';
import { Switch } from '../../../components/ui/switch.js';
import { ToggleCard } from '../../../components/ui/toggle-card.js';
import { dashboardApi } from '../../../lib/api.js';
import { toast } from '../../../lib/toast.js';
import { DeleteWorkspaceDialog } from '../list/workspace-list-page.dialogs.js';
import type { WorkspaceOverview } from './workspace-detail-support.js';
import { WorkspaceSettingsShell } from './workspace-settings-shell.js';
import { buildStorageSummary } from './workspace-settings-storage-summary.js';
import {
  SecretDisclosureRow,
  SettingsDisclosureSection,
  StaticSettingsSection,
  TextField,
} from './workspace-settings-tab.controls.js';
import {
  buildWorkspaceGitAccessVerificationFingerprint,
  buildWorkspaceGitAccessVerificationInput,
  buildWorkspaceSettingsPatch,
  buildWorkspaceSettingsSurfaceSummary,
  createWorkspaceSettingsDraft,
  formatWorkspaceGitVerificationErrorMessage,
  requiresWorkspaceGitAccessVerification,
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

export function WorkspaceSettingsTab(props: {
  workspace: DashboardWorkspaceRecord;
  overview: WorkspaceOverview;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => createWorkspaceSettingsDraft(props.workspace));
  const [showDelete, setShowDelete] = useState(false);
  const [isGitTokenExpanded, setGitTokenExpanded] = useState(false);
  const [isDangerExpanded, setDangerExpanded] = useState(false);
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);
  const [verifiedGitAccessFingerprint, setVerifiedGitAccessFingerprint] = useState<string | null>(
    null,
  );
  const [gitVerificationIssue, setGitVerificationIssue] = useState<{
    fingerprint: string;
    message: string;
  } | null>(null);
  const validation = validateWorkspaceSettingsDraft(draft);
  const surfaceSummary = buildWorkspaceSettingsSurfaceSummary(props.workspace, draft, validation);
  const verificationRequired = requiresWorkspaceGitAccessVerification(props.workspace, draft);
  const gitVerificationFingerprint = buildWorkspaceGitAccessVerificationFingerprint(draft);
  const activeGitVerificationIssue =
    gitVerificationIssue?.fingerprint === gitVerificationFingerprint
      ? gitVerificationIssue.message
      : null;
  const blockingIssues = activeGitVerificationIssue
    ? [...validation.blockingIssues, activeGitVerificationIssue]
    : validation.blockingIssues;

  const verifyMutation = useMutation({
    mutationFn: () =>
      dashboardApi.verifyWorkspaceGitAccess(
        props.workspace.id,
        buildWorkspaceGitAccessVerificationInput(draft),
      ),
    onSuccess: () => {
      setVerifiedGitAccessFingerprint(gitVerificationFingerprint);
      setGitVerificationIssue(null);
    },
  });
  const mutation = useMutation({
    mutationFn: () =>
      dashboardApi.patchWorkspace(
        props.workspace.id,
        buildWorkspaceSettingsPatch(props.workspace, draft),
      ),
    onSuccess: async (updatedWorkspace) => {
      setDraft(createWorkspaceSettingsDraft(updatedWorkspace));
      setGitTokenExpanded(false);
      setVerifiedGitAccessFingerprint(null);
      setGitVerificationIssue(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workspace', props.workspace.id] }),
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
      ]);
      toast.success('Workspace settings saved.');
    },
  });
  const isSavePending = mutation.isPending || verifyMutation.isPending;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError: mutation.error ? String(mutation.error) : activeGitVerificationIssue,
    showValidation: hasAttemptedSave,
    isValid: validation.isValid,
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  const storageSummary = buildStorageSummary(draft, surfaceSummary.storageLabel);

  async function handleSave() {
    if (!validation.isValid) {
      setHasAttemptedSave(true);
      return;
    }

    if (verificationRequired && verifiedGitAccessFingerprint !== gitVerificationFingerprint) {
      try {
        await verifyMutation.mutateAsync();
      } catch (error) {
        setGitVerificationIssue({
          fingerprint: gitVerificationFingerprint,
          message: formatWorkspaceGitVerificationErrorMessage(error),
        });
        return;
      }
    }

    await mutation.mutateAsync();
  }

  return (
    <>
      <WorkspaceSettingsShell
        workspace={props.workspace}
        overview={props.overview}
        headerFeedback={<FormFeedbackMessage message={formFeedbackMessage} />}
        headerAction={
          <Button
            size="sm"
            disabled={isSavePending}
            onClick={() => {
              void handleSave();
            }}
          >
            <Save className="h-4 w-4" />
            Save settings
          </Button>
        }
      >
        <StaticSettingsSection
          id="workspace-settings-basics"
          title="Workspace Basics"
          description="Rename the workspace, adjust its URL slug, and control whether it can receive new work."
          headerAction={
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted">
                {draft.isActive ? 'Active' : 'Inactive'}
              </span>
              <Switch
                checked={draft.isActive}
                aria-label="Workspace active"
                onCheckedChange={(checked) =>
                  setDraft((current) => ({ ...current, isActive: checked }))
                }
              />
            </div>
          }
        >
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <TextField
                label="Name"
                value={draft.name}
                error={hasAttemptedSave ? validation.fieldErrors.name : undefined}
                onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
              />
              <TextField
                label="Slug"
                value={draft.slug}
                error={hasAttemptedSave ? validation.fieldErrors.slug : undefined}
                onChange={(value) => setDraft((current) => ({ ...current, slug: value }))}
              />
            </div>
          </div>
        </StaticSettingsSection>

        <StaticSettingsSection
          id="workspace-settings-storage"
          title="Workspace Storage"
          description="Choose how specialists access and persist files for this workspace."
          summary={storageSummary}
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
                    error={hasAttemptedSave ? validation.fieldErrors.repositoryUrl : undefined}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, repositoryUrl: value }))
                    }
                  />
                  <TextField
                    label="Default branch"
                    value={draft.defaultBranch}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, defaultBranch: value }))
                    }
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <TextField
                    label="Git user name"
                    value={draft.gitUserName}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, gitUserName: value }))
                    }
                  />
                  <TextField
                    label="Git user email"
                    value={draft.gitUserEmail}
                    error={hasAttemptedSave ? validation.fieldErrors.gitUserEmail : undefined}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, gitUserEmail: value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <SecretDisclosureRow
                    label="Git token"
                    draft={draft.credentials.gitToken}
                    error={hasAttemptedSave ? validation.fieldErrors.gitToken : undefined}
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
                  error={hasAttemptedSave ? validation.fieldErrors.hostPath : undefined}
                  onChange={(value) => setDraft((current) => ({ ...current, hostPath: value }))}
                />
                <p className="text-sm leading-6 text-muted">
                  The path must already exist. All specialist agents are expected to mount the same
                  path. Writes happen as the specialist execution user, which is currently `root`.
                </p>
                <ToggleCard
                  label="Read-only mount"
                  description="Mount this path read-only for task runs."
                  checked={draft.readOnly}
                  checkedLabel="Read-only"
                  uncheckedLabel="Read-write"
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({ ...current, readOnly: checked }))
                  }
                />
              </div>
            ) : null}

            {draft.storageType === 'workspace_artifacts' ? (
              <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-sm leading-6 text-muted">
                Workspace artifacts is storage that is built into the platform. You can use the
                Knowledge tab to upload artifacts that will be accessible to specialists, and
                specialists wlil be instructed to rely on built-in storage when reading and
                producing materials.
              </div>
            ) : null}
          </div>
        </StaticSettingsSection>
        <SettingsDisclosureSection
          id="workspace-settings-danger"
          title="Danger"
          description="Permanently remove this workspace when it should no longer exist for this tenant."
          actionLabel={isDangerExpanded ? 'Hide danger' : 'Open danger'}
          isExpanded={isDangerExpanded}
          onToggle={() => setDangerExpanded((current) => !current)}
        >
          <Button variant="destructive" type="button" onClick={() => setShowDelete(true)}>
            Delete workspace
          </Button>
        </SettingsDisclosureSection>
      </WorkspaceSettingsShell>
      {showDelete ? (
        <DeleteWorkspaceDialog workspace={props.workspace} onClose={() => setShowDelete(false)} />
      ) : null}
    </>
  );
}
