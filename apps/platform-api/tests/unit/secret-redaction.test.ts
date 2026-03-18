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

  it('redacts strings that embed bearer or api key secrets inside longer text', () => {
    expect(
      sanitizeSecretLikeValue({
        handoff_summary: 'Implemented the feature. Validation token: Bearer sk-live-secret-value.',
        note: 'Replay with Bearer sk-live-output-secret if the preview fails.',
      }),
    ).toEqual({
      handoff_summary: 'redacted://secret',
      note: 'redacted://secret',
    });
  });
});
