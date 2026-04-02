import { describe, expect, it } from 'vitest';

import { DEFAULT_PLATFORM_INSTRUCTIONS } from '../../../src/catalogs/default-prompts.js';

describe('DEFAULT_PLATFORM_INSTRUCTIONS', () => {
  it('treats explicit repo-relative paths as authoritative before alternate guesses', () => {
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain(
      'If task input, predecessor handoff, or linked deliverables name an exact repo-relative path, treat that path as authoritative.',
    );
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain(
      'Read that exact path first, and if it is missing, use file_list, glob, grep, or git discovery to find the current equivalent before trying alternate filenames.',
    );
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain(
      'On repository-backed investigation tasks, if the current file set is unknown, start with file_list, glob, grep, or git discovery before the first direct repo file_read.',
    );
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain(
      'Do not probe guessed filenames just to learn whether they exist.',
    );
  });
});
