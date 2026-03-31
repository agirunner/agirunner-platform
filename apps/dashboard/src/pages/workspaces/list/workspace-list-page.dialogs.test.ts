import { describe, expect, it } from 'vitest';

import {
  formatWorkspaceDeleteError,
  formatWorkspaceDialogError,
} from './workspace-list-page.dialogs.js';

describe('workspace list page dialog errors', () => {
  it('turns generic conflict failures into a clear duplicate slug message', () => {
    expect(formatWorkspaceDialogError(new Error('HTTP 409'))).toBe(
      'That workspace slug already exists. Choose a different slug.',
    );
  });

  it('preserves more specific workspace conflict messages when they already explain the problem', () => {
    expect(formatWorkspaceDialogError(new Error('Workspace slug already exists'))).toBe(
      'That workspace slug already exists. Choose a different slug.',
    );
  });

  it('falls back to the original message for non-conflict failures', () => {
    expect(formatWorkspaceDialogError(new Error('network unavailable'))).toBe('network unavailable');
  });

  it('keeps destructive delete failures readable for inline dialog display', () => {
    expect(
      formatWorkspaceDeleteError(
        new Error('HTTP 409: Workspace still has linked workflows and tasks.'),
      ),
    ).toBe('Workspace still has linked workflows and tasks.');
  });
});
