import { describe, expect, it } from 'vitest';

import * as workspaceSettingsSupport from './workspace-settings-support.js';

describe('workspace settings verification error formatting', () => {
  it('strips HTTP status prefixes before verification issues reach the blocking panel', () => {
    expect(
      workspaceSettingsSupport.formatWorkspaceGitVerificationErrorMessage?.(
        new Error(
          'HTTP 400: Stored Git token could not be read for verification. Replace the token before changing the repository.',
        ),
      ),
    ).toBe(
      'Stored Git token could not be read for verification. Replace the token before changing the repository.',
    );
  });

  it('falls back to the default verification message when the error is not usable', () => {
    expect(
      workspaceSettingsSupport.formatWorkspaceGitVerificationErrorMessage?.(null),
    ).toBe('Git access verification failed before saving workspace settings.');
  });
});
