import { describe, expect, it } from 'vitest';

import {
  buildProjectSecretPostureSummary,
  buildProjectSettingsSurfaceSummary,
  buildProjectSettingsPatch,
  createProjectSettingsDraft,
  readProjectSettings,
  summarizeProjectBrief,
  validateProjectSettingsDraft,
} from './project-settings-support.js';

describe('project settings support', () => {
  it('hydrates typed project settings and secret posture from the dashboard project record', () => {
    const settings = readProjectSettings({
      id: 'project-1',
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
          git_token: 'redacted://project-settings-secret',
          git_token_configured: true,
        },
        project_brief: 'Keep release automation ready for Friday handoff.',
      },
    });

    expect(settings.defaultBranch).toBe('main');
    expect(settings.gitUserName).toBe('Release Bot');
    expect(settings.gitUserEmail).toBe('release@example.test');
    expect(settings.credentials.gitToken.configured).toBe(true);
  });

  it('builds a full patch that preserves configured git tokens and operator-facing extras', () => {
    const project = {
      id: 'project-1',
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
          git_token: 'redacted://project-settings-secret',
          git_token_configured: true,
        },
        project_brief: 'Keep release automation ready for Friday handoff.',
        extra_retention_window: 7,
      },
    };

    const draft = createProjectSettingsDraft(project);
    draft.description = 'Ship weekly with operator-ready controls.';
    draft.defaultBranch = 'release';
    draft.credentials.gitToken.mode = 'preserve';

    expect(buildProjectSettingsPatch(project, draft)).toEqual({
      name: 'Release automation',
      slug: 'release-automation',
      description: 'Ship weekly with operator-ready controls.',
      repository_url: 'https://example.com/repo.git',
      is_active: true,
      settings: {
        default_branch: 'release',
        git_user_name: 'Release Bot',
        git_user_email: 'release@example.test',
        credentials: {
          git_token: 'redacted://project-settings-secret',
          git_token_configured: true,
        },
        extra_retention_window: 7,
      },
    });
  });

  it('returns inline validation errors and save blockers for invalid project settings drafts', () => {
    const draft = createProjectSettingsDraft({
      id: 'project-1',
      name: 'Release automation',
      slug: 'release-automation',
      description: 'Ship weekly safely.',
      repository_url: 'https://example.com/repo.git',
      is_active: true,
      settings: {
        credentials: {
          git_token: 'redacted://project-settings-secret',
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

    const validation = validateProjectSettingsDraft(draft);

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
    const project = {
      id: 'project-1',
      name: 'Release automation',
      slug: 'release-automation',
      description: 'Ship weekly safely.',
      repository_url: 'https://example.com/repo.git',
      is_active: true,
      settings: {
        credentials: {
          git_token: 'redacted://project-settings-secret',
          git_token_configured: true,
        },
      },
    };

    const draft = createProjectSettingsDraft(project);
    const validation = validateProjectSettingsDraft(draft);
    const summary = buildProjectSettingsSurfaceSummary(project, draft, validation);

    expect(summary.configuredSecretCount).toBe(1);
    expect(summary.configuredSecretLabel).toBe('1 secret configured');
    expect(summary.stagedSecretChangeCount).toBe(0);
    expect(summary.stagedSecretChangeLabel).toBe('No secret changes staged');
    expect(summary.repositoryLabel).toBe('Repository linked');
    expect(summary.lifecycleLabel).toBe('Active project');
    expect(summary.blockingIssueCount).toBe(0);
    expect(summary.blockingTitle).toBe('Resolve before saving');
  });

  it('treats repository links as optional in the compact settings summaries', () => {
    const project = {
      id: 'project-1',
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

    const draft = createProjectSettingsDraft(project);
    draft.credentials.gitToken.mode = 'replace';
    draft.credentials.gitToken.value = 'rotate-me';
    const summary = buildProjectSettingsSurfaceSummary(
      project,
      draft,
      validateProjectSettingsDraft(draft),
    );

    expect(summary.repositoryLabel).toBe('Repository optional');
    expect(summary.lifecycleLabel).toBe('Inactive project');
    expect(summary.stagedSecretChangeCount).toBe(1);
    expect(summary.stagedSecretChangeLabel).toBe('1 secret change staged');
  });

  it('defaults credential drafts to preserve mode until an operator explicitly opens a change path', () => {
    const draft = createProjectSettingsDraft({
      id: 'project-1',
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

  it('builds calm collapsed summaries for credentials and project context', () => {
    expect(
      buildProjectSecretPostureSummary({
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
      buildProjectSecretPostureSummary({
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

    expect(summarizeProjectBrief('')).toBe('No project context saved yet.');
    expect(
      summarizeProjectBrief('Keep release automation ready for Friday handoff.\nTrack rollback notes.'),
    ).toBe('Keep release automation ready for Friday handoff.');
  });
});
