import { describe, expect, it } from 'vitest';

import { normalizeInstructionDocument } from '../../../src/services/platform-config/instruction-policy.js';

describe('normalizeInstructionDocument', () => {
  it('accepts instruction arrays and preserves ordering as markdown bullets', () => {
    const document = normalizeInstructionDocument(
      ['Clarify the accepted input contract.', 'Expand edge-case test coverage.'],
      'task instructions',
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
    );

    expect(document).toBeNull();
  });

  it('rejects non-string instruction array entries', () => {
    expect(() =>
      normalizeInstructionDocument(
        ['Valid instruction', { text: 'invalid' }],
        'task instructions',
      ),
    ).toThrow('task instructions array entries must be strings');
  });

  it('accepts oversized instruction content without truncation or rejection', () => {
    const content = 'Long instruction block. '.repeat(2500);

    const document = normalizeInstructionDocument(content, 'task instructions');

    expect(document).toEqual({
      content: content.trim(),
      format: 'text',
    });
  });
});
