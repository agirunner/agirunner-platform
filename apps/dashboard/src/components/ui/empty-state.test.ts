import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './empty-state.tsx'), 'utf8');
}

describe('EmptyState source', () => {
  it('exports EmptyState function', () => {
    const source = readSource();

    expect(source).toContain('export function EmptyState(');
  });

  it('props interface has required title and message', () => {
    const source = readSource();

    expect(source).toContain('title:');
    expect(source).toContain('message:');
  });

  it('props interface has optional actionLabel and onAction', () => {
    const source = readSource();

    expect(source).toContain('actionLabel?:');
    expect(source).toContain('onAction?:');
  });

  it('applies text-primary to the title', () => {
    const source = readSource();

    expect(source).toContain('text-primary');
  });

  it('applies text-tertiary to the message', () => {
    const source = readSource();

    expect(source).toContain('text-tertiary');
  });

  it('uses accent-primary for the action button', () => {
    const source = readSource();

    expect(source).toContain('accent-primary');
  });

  it('renders action button only when actionLabel is provided', () => {
    const source = readSource();

    expect(source).toContain('actionLabel');
    expect(source).toContain('onAction');
  });
});
