import { describe, expect, it } from 'vitest';

import { normalizeInstructionDocument } from '../../src/services/instruction-policy.js';

describe('normalizeInstructionDocument', () => {
  it('accepts instruction arrays and preserves ordering as markdown bullets', () => {
    const document = normalizeInstructionDocument(
      ['Clarify the accepted input contract.', 'Expand edge-case test coverage.'],
      'task instructions',
      10_000,
    );

    expect(document).toEqual({
      content: '- Clarify the accepted input contract.\n- Expand edge-case test coverage.',
      format: 'markdown',
    });
  });

  it('drops blank array entries and returns null when nothing meaningful remains', () => {
    const document = normalizeInstructionDocument(
      ['   ', '\n'],
      'task instructions',
      10_000,
    );

    expect(document).toBeNull();
  });

  it('rejects non-string instruction array entries', () => {
    expect(() =>
      normalizeInstructionDocument(
        ['Valid instruction', { text: 'invalid' }],
        'task instructions',
        10_000,
      ),
    ).toThrow('task instructions array entries must be strings');
  });
});
