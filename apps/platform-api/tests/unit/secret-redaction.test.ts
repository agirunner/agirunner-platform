import { describe, expect, it } from 'vitest';

import { sanitizeSecretLikeValue } from '../../src/services/secret-redaction.js';

describe('sanitizeSecretLikeValue', () => {
  it('does not redact ordinary ids that only contain an sk- substring', () => {
    expect(
      sanitizeSecretLikeValue({
        task_id: 'task-pm-1',
        artifact_task_id: 'task-arch-1',
      }),
    ).toEqual({
      task_id: 'task-pm-1',
      artifact_task_id: 'task-arch-1',
    });
  });

  it('still redacts explicit OpenAI-style secret values', () => {
    expect(sanitizeSecretLikeValue({ api_key: 'sk-secret-value' })).toEqual({
      api_key: 'redacted://secret',
    });
  });
});
