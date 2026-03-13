import { describe, expect, it } from 'vitest';

import {
  buildEditToolForm,
  createToolIdFromName,
  describeToolCategory,
  summarizeTools,
  validateCreateToolForm,
  validateEditToolForm,
} from './tools-page.support.js';

describe('tools page support', () => {
  it('builds a stable snake_case tool id from the name', () => {
    expect(createToolIdFromName(' Code Formatter v2 ')).toBe('code_formatter_v2');
  });

  it('validates tool creation requirements and duplicate ids', () => {
    expect(
      validateCreateToolForm(
        { id: 'Git-Diff', name: '', description: '', category: 'vcs' },
        [{ id: 'git_diff', name: 'Git Diff' }],
      ),
    ).toEqual({
      fieldErrors: {
        name: 'Enter a tool name.',
        id: 'Use lowercase letters, numbers, and underscores only.',
      },
      blockingIssues: [
        'Enter a tool name.',
        'Use lowercase letters, numbers, and underscores only.',
      ],
      advisoryIssues: [
        'Add a short description so operators understand when this tool should be granted.',
      ],
      isValid: false,
    });

    expect(
      validateCreateToolForm(
        { id: 'git_diff', name: 'Git Diff', description: 'Shows diffs', category: 'vcs' },
        [{ id: 'git_diff', name: 'Git Diff' }],
      ).fieldErrors.id,
    ).toBe('Choose a unique tool ID.');
  });

  it('summarizes catalog posture and describes categories for operators', () => {
    expect(
      summarizeTools([
        { id: 'shell_exec', name: 'Shell exec', category: 'runtime', description: 'Run commands' },
        { id: 'web_fetch', name: 'Web fetch', category: 'web' },
      ]),
    ).toEqual([
      {
        label: 'Catalog size',
        value: '2 tools',
        detail: '1 runtime tool currently registered.',
      },
      {
        label: 'Category coverage',
        value: '2 categories',
        detail: 'runtime, web currently represented in the tool catalog.',
      },
      {
        label: 'Documentation posture',
        value: '1/2 described',
        detail: '1 tool still needs a description.',
      },
    ]);

    expect(describeToolCategory('integration')).toEqual({
      label: 'Integration',
      detail: 'Outbound connectors and system-specific tool bridges.',
      badgeVariant: 'success',
    });
  });

  it('builds an edit form from a tool tag', () => {
    expect(
      buildEditToolForm({ id: 'my_tool', name: 'My Tool', description: '  Desc  ', category: 'web' }),
    ).toEqual({ name: 'My Tool', description: 'Desc', category: 'web' });
  });

  it('defaults missing category to runtime in edit form', () => {
    expect(
      buildEditToolForm({ id: 'x', name: 'X' }),
    ).toEqual({ name: 'X', description: '', category: 'runtime' });
  });

  it('validates edit form requires a name', () => {
    const result = validateEditToolForm({ name: '', description: 'something', category: 'runtime' });
    expect(result.isValid).toBe(false);
    expect(result.fieldErrors.name).toBe('Enter a tool name.');
    expect(result.blockingIssues).toContain('Enter a tool name.');
  });

  it('validates edit form passes with valid name', () => {
    const result = validateEditToolForm({ name: 'Good Name', description: '', category: 'web' });
    expect(result.isValid).toBe(true);
    expect(result.advisoryIssues).toContain(
      'Add a short description so operators understand when this tool should be granted.',
    );
  });
});
