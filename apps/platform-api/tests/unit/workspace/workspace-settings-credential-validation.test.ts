import { describe, expect, it } from 'vitest';

import { validateWorkspaceSettingsShape } from '../../../src/services/workspace/workspace-settings.js';

describe('workspace settings credential validation', () => {
  it('rejects git tokens with whitespace', () => {
    expect(() =>
      validateWorkspaceSettingsShape({
        credentials: {
          git_token: 'url.https://x-access-token:token@github.com/.insteadof https://github.com/',
        },
      }),
    ).toThrow(/git_token.*must not contain whitespace/i);
  });
});
