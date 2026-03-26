import { describe, expect, it } from 'vitest';

import {
  buildWorkspaceGitAccessVerificationFingerprint,
  buildWorkspaceGitAccessVerificationInput,
  buildWorkspaceSecretPostureSummary,
  buildWorkspaceSettingsSurfaceSummary,
  buildWorkspaceSettingsPatch,
  createWorkspaceSettingsDraft,
  requiresWorkspaceGitAccessVerification,
  readWorkspaceSettings,
  summarizeWorkspaceBrief,
  validateWorkspaceSettingsDraft,
} from './workspace-settings-support.js';

describe('workspace settings support', () => {
  it('hydrates typed workspace settings and secret posture from the dashboard workspace record', () => {
    const settings = readWorkspaceSettings({
      id: 'workspace-1',
      name: 'Release automation',
      slug: 'release-automation',
      description: 'Ship weekly safely.',
      repository_url: 'https://example.com/repo.git',
      is_active: true,
      settings: {
        default_branch: 'main',
        git_user_name: 'Release Bot',
        git_user_email: 'release@example.test',
        credentials: {
          git_token: 'redacted://workspace-settings-secret',
          git_token_configured: true,
        },
        workspace_brief: 'Keep release automation ready for Friday handoff.',
      },
    });

    expect(settings.defaultBranch).toBe('main');
    expect(settings.gitUserName).toBe('Release Bot');
    expect(settings.gitUserEmail).toBe('release@example.test');
    expect(settings.credentials.gitToken.configured).toBe(true);
  });

  it('builds a full patch that preserves configured git tokens and operator-facing extras', () => {
    const workspace = {
      id: 'workspace-1',
      name: 'Release automation',
      slug: 'release-automation',
      description: 'Ship weekly safely.',
      repository_url: 'https://example.com/repo.git',
      is_active: true,
      settings: {
        default_branch: 'main',
        git_user_name: 'Release Bot',
        git_user_email: 'release@example.test',
        credentials: {
          git_token: 'redacted://workspace-settings-secret',
          git_token_configured: true,
        },
        workspace_brief: 'Keep release automation ready for Friday handoff.',
        extra_retention_window: 7,
      },
    };

    const draft = createWorkspaceSettingsDraft(workspace);
    draft.description = 'Ship weekly with operator-ready controls.';
    draft.defaultBranch = 'release';
    draft.credentials.gitToken.mode = 'preserve';

    expect(buildWorkspaceSettingsPatch(workspace, draft)).toEqual({
      name: 'Release automation',
      slug: 'release-automation',
      description: 'Ship weekly with operator-ready controls.',
      is_active: true,
      settings: {
        workspace_storage_type: 'git_remote',
        workspace_storage: {
          repository_url: 'https://example.com/repo.git',
          default_branch: 'release',
          git_user_name: 'Release Bot',
          git_user_email: 'release@example.test',
        },
        default_branch: 'release',
        git_user_name: 'Release Bot',
        git_user_email: 'release@example.test',
        credentials: {
          git_token: 'redacted://workspace-settings-secret',
          git_token_configured: true,
        },
        extra_retention_window: 7,
        workspace_brief: 'Keep release automation ready for Friday handoff.',
      },
    });
  });

  it('returns inline validation errors and save blockers for invalid workspace settings drafts', () => {
    const draft = createWorkspaceSettingsDraft({
      id: 'workspace-1',
      name: 'Release automation',
      slug: 'release-automation',
      description: 'Ship weekly safely.',
      repository_url: 'https://example.com/repo.git',
      is_active: true,
      settings: {
        credentials: {
          git_token: 'redacted://workspace-settings-secret',
          git_token_configured: true,
        },
      },
    });

    draft.name = ' ';
    draft.slug = ' ';
    draft.repositoryUrl = 'not-a-url';
    draft.gitUserEmail = 'bad-email';
    draft.credentials.gitToken.mode = 'replace';
    draft.credentials.gitToken.value = ' ';

    const validation = validateWorkspaceSettingsDraft(draft);

    expect(validation.isValid).toBe(false);
    expect(validation.fieldErrors.name).toMatch(/name is required/i);
    expect(validation.fieldErrors.slug).toMatch(/slug is required/i);
    expect(validation.fieldErrors.repositoryUrl).toMatch(/valid url/i);
    expect(validation.fieldErrors.gitUserEmail).toMatch(/valid email/i);
    expect(validation.fieldErrors.gitToken).toMatch(/enter a new value/i);
    expect(validation.blockingIssues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/name is required/i),
        expect.stringMatching(/repository url must be a valid url/i),
        expect.stringMatching(/git identity email must be a valid email/i),
        expect.stringMatching(/enter a new value for git token/i),
      ]),
    );
  });

  it('builds a compact surface summary with git and repository posture', () => {
    const workspace = {
      id: 'workspace-1',
      name: 'Release automation',
      slug: 'release-automation',
      description: 'Ship weekly safely.',
      repository_url: 'https://example.com/repo.git',
      is_active: true,
      settings: {
        credentials: {
          git_token: 'redacted://workspace-settings-secret',
          git_token_configured: true,
        },
      },
    };

    const draft = createWorkspaceSettingsDraft(workspace);
    const validation = validateWorkspaceSettingsDraft(draft);
    const summary = buildWorkspaceSettingsSurfaceSummary(workspace, draft, validation);

    expect(summary.configuredSecretCount).toBe(1);
    expect(summary.configuredSecretLabel).toBe('1 secret configured');
    expect(summary.stagedSecretChangeCount).toBe(0);
    expect(summary.stagedSecretChangeLabel).toBe('No secret changes staged');
    expect(summary.storageLabel).toBe('Git Remote');
    expect(summary.lifecycleLabel).toBe('Active workspace');
    expect(summary.blockingIssueCount).toBe(0);
    expect(summary.blockingTitle).toBe('Resolve before saving');
  });

  it('defaults new workspaces to workspace artifacts in the compact settings summaries', () => {
    const workspace = {
      id: 'workspace-1',
      name: 'Release automation',
      slug: 'release-automation',
      description: 'Ship weekly safely.',
      repository_url: null,
      is_active: false,
      settings: {
        credentials: {
          git_token: null,
          git_token_configured: false,
        },
      },
    };

    const draft = createWorkspaceSettingsDraft(workspace);
    draft.credentials.gitToken.mode = 'replace';
    draft.credentials.gitToken.value = 'rotate-me';
    const summary = buildWorkspaceSettingsSurfaceSummary(
      workspace,
      draft,
      validateWorkspaceSettingsDraft(draft),
    );

    expect(summary.storageLabel).toBe('Workspace Artifacts');
    expect(summary.lifecycleLabel).toBe('Inactive workspace');
    expect(summary.stagedSecretChangeCount).toBe(1);
    expect(summary.stagedSecretChangeLabel).toBe('1 secret change staged');
  });

  it('defaults credential drafts to preserve mode until an operator explicitly opens a change path', () => {
    const draft = createWorkspaceSettingsDraft({
      id: 'workspace-1',
      name: 'Release automation',
      slug: 'release-automation',
      description: 'Ship weekly safely.',
      repository_url: 'https://example.com/repo.git',
      is_active: true,
      settings: {
        credentials: {
          git_token: null,
          git_token_configured: false,
        },
      },
    });

    expect(draft.credentials.gitToken.mode).toBe('preserve');
  });

  it('builds calm collapsed summaries for credentials and workspace context', () => {
    expect(
      buildWorkspaceSecretPostureSummary({
        configured: false,
        mode: 'preserve',
        value: '',
      }),
    ).toEqual({
      statusLabel: 'Not configured',
      postureLabel: 'Still empty',
      detail: 'No stored value yet.',
      tone: 'default',
    });

    expect(
      buildWorkspaceSecretPostureSummary({
        configured: true,
        mode: 'replace',
        value: '',
      }),
    ).toEqual({
      statusLabel: 'Configured',
      postureLabel: 'Updates on save',
      detail: 'Enter a new value before saving.',
      tone: 'warning',
    });

    expect(summarizeWorkspaceBrief('')).toBe('No workspace context saved yet.');
    expect(
      summarizeWorkspaceBrief('Keep release automation ready for Friday handoff.\nTrack rollback notes.'),
    ).toBe('Keep release automation ready for Friday handoff.');
  });

  it('requires git verification when repository access changes for a git remote workspace', () => {
    const workspace = {
      id: 'workspace-1',
      name: 'Release automation',
      slug: 'release-automation',
      description: 'Ship weekly safely.',
      repository_url: 'https://github.com/example/repo.git',
      is_active: true,
      settings: {
        default_branch: 'main',
        credentials: {
          git_token: 'redacted://workspace-settings-secret',
          git_token_configured: true,
        },
      },
    };

    const unchanged = createWorkspaceSettingsDraft(workspace);
    const changedRepository = createWorkspaceSettingsDraft(workspace);
    changedRepository.repositoryUrl = 'https://github.com/example/other-repo.git';
    const changedToken = createWorkspaceSettingsDraft(workspace);
    changedToken.credentials.gitToken.mode = 'replace';
    changedToken.credentials.gitToken.value = 'ghp_changed';

    expect(requiresWorkspaceGitAccessVerification(workspace, unchanged)).toBe(false);
    expect(requiresWorkspaceGitAccessVerification(workspace, changedRepository)).toBe(true);
    expect(requiresWorkspaceGitAccessVerification(workspace, changedToken)).toBe(true);
  });

  it('builds a stable git verification payload and fingerprint from the workspace draft', () => {
    const workspace = {
      id: 'workspace-1',
      name: 'Release automation',
      slug: 'release-automation',
      description: 'Ship weekly safely.',
      repository_url: null,
      is_active: true,
      settings: {},
    };

    const draft = createWorkspaceSettingsDraft(workspace);
    draft.storageType = 'git_remote';
    draft.repositoryUrl = 'https://github.com/example/private-repo.git';
    draft.defaultBranch = 'release';
    draft.credentials.gitToken.mode = 'replace';
    draft.credentials.gitToken.value = 'ghp_live_value';

    expect(buildWorkspaceGitAccessVerificationInput(draft)).toEqual({
      repository_url: 'https://github.com/example/private-repo.git',
      default_branch: 'release',
      git_token_mode: 'replace',
      git_token: 'ghp_live_value',
    });
    expect(buildWorkspaceGitAccessVerificationFingerprint(draft)).toBe(
      JSON.stringify({
        storageType: 'git_remote',
        repositoryUrl: 'https://github.com/example/private-repo.git',
        defaultBranch: 'release',
        gitTokenMode: 'replace',
        gitTokenValue: 'ghp_live_value',
      }),
    );
  });
});
