import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MemoryValuePreview } from './project-memory-table.fields.js';

describe('project memory field rendering', () => {
  it('does not render scalar memory values twice', () => {
    const markup = renderToStaticMarkup(<MemoryValuePreview value="Revenue Systems" />);

    expect(markup).toContain('Revenue Systems');
    expect(markup.match(/Revenue Systems/g)).toHaveLength(1);
    expect(markup).toContain('string');
  });
});
