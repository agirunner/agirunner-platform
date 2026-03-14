import { describe, expect, it } from 'vitest';

import { buttonVariants } from './button.js';

describe('button variants', () => {
  it('keeps default button links readable when rendered as anchors', () => {
    const classes = buttonVariants({ variant: 'default' });

    expect(classes).toContain('!text-accent-foreground');
    expect(classes).toContain('no-underline');
  });

  it('keeps outline button links on the normal foreground color', () => {
    const classes = buttonVariants({ variant: 'outline' });

    expect(classes).toContain('!text-foreground');
    expect(classes).toContain('no-underline');
  });
});
