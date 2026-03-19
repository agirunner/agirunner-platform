import { describe, expect, it } from 'vitest';

import { validateWorkspaceForm } from './workspace-creation-form.js';

describe('validateWorkspaceForm', () => {
  it('returns errors for empty fields', () => {
    const errors = validateWorkspaceForm({ name: '', repoUrl: '' });
    expect(errors).toContain('Name is required');
    expect(errors).toContain('Repository URL is required');
  });

  it('returns error for empty name only', () => {
    const errors = validateWorkspaceForm({ name: '', repoUrl: 'https://github.com/org/repo' });
    expect(errors).toContain('Name is required');
    expect(errors).not.toContain('Repository URL is required');
  });

  it('returns error for empty repoUrl only', () => {
    const errors = validateWorkspaceForm({ name: 'My Workspace', repoUrl: '' });
    expect(errors).not.toContain('Name is required');
    expect(errors).toContain('Repository URL is required');
  });

  it('returns empty for valid data', () => {
    expect(validateWorkspaceForm({ name: 'My Workspace', repoUrl: 'https://github.com/org/repo' })).toEqual([]);
  });
});

import { WorkspaceCreationForm } from './workspace-creation-form.js';

describe('WorkspaceCreationForm', () => {
  it('exports WorkspaceCreationForm', () => expect(typeof WorkspaceCreationForm).toBe('function'));
});
