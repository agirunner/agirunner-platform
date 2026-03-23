import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './approval-queue-review-disclosure.tsx'), 'utf8');
}

describe('approval queue review disclosure source', () => {
  it('uses an explicit keyboard-safe disclosure with focus restoration', () => {
    const source = readSource();
    expect(source).toContain('aria-expanded={isOpen}');
    expect(source).toContain('aria-controls={panelId}');
    expect(source).toContain('role="region"');
    expect(source).toContain('requestAnimationFrame(() => triggerRef.current?.focus())');
    expect(source).toContain('panelHeadingRef.current?.focus()');
    expect(source).toContain('Hide full decision packet');
    expect(source).toContain('Collapse packet');
    expect(source).not.toContain('<details');
  });
});
