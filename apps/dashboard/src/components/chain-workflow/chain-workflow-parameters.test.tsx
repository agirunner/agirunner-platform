import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ChainParameterField } from './chain-workflow-parameters.js';

describe('ChainParameterField', () => {
  it('can hide the slug badge and render multiline string inputs', () => {
    const html = renderToStaticMarkup(
      createElement(ChainParameterField, {
        spec: {
          slug: 'goal',
          title: 'Goal',
          required: true,
        },
        value: 'Ship release 24.4',
        onChange: vi.fn(),
        showSlugBadge: false,
        multiline: true,
      }),
    );

    expect(html).toContain('Goal');
    expect(html).toContain('Required');
    expect(html).not.toContain('goal');
    expect(html).toContain('<textarea');
    expect(html).toContain('min-h-[64px]');
  });
});
