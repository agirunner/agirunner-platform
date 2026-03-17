import { describe, expect, it } from 'vitest';

import { validateProjectSettingsShape } from '../../src/services/project-settings.js';

describe('project settings credential validation', () => {
  it('rejects git tokens with whitespace', () => {
    expect(() =>
      validateProjectSettingsShape({
        credentials: {
          git_token: 'url.https://x-access-token:token@github.com/.insteadof https://github.com/',
        },
      }),
    ).toThrow(/git_token.*must not contain whitespace/i);
  });
});
