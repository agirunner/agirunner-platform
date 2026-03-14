import { describe, expect, it } from 'vitest';

import { formatProjectDialogError } from './project-list-page.dialogs.js';

describe('project list page dialog errors', () => {
  it('turns generic conflict failures into a clear duplicate slug message', () => {
    expect(formatProjectDialogError(new Error('HTTP 409'))).toBe(
      'That project slug already exists. Choose a different slug.',
    );
  });

  it('preserves more specific project conflict messages when they already explain the problem', () => {
    expect(formatProjectDialogError(new Error('Project slug already exists'))).toBe(
      'That project slug already exists. Choose a different slug.',
    );
  });

  it('falls back to the original message for non-conflict failures', () => {
    expect(formatProjectDialogError(new Error('network unavailable'))).toBe('Error: network unavailable');
  });
});
