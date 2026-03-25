import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(
    resolve(import.meta.dirname, './log-classification-tabs.tsx'),
    'utf8',
  );
}

describe('log classification tabs source', () => {
  it('includes platform categories and strong active and inactive tab contrast', () => {
    const source = readSource();

    expect(source).toContain("{ id: 'platform', label: 'Platform', categories: ['api', 'config', 'auth'] }");
    expect(source).toContain('border border-border/70 bg-card/80');
    expect(source).toContain('bg-sky-600 text-white');
    expect(source).toContain('dark:bg-sky-400');
    expect(source).toContain('text-foreground/80');
    expect(source).toContain('hover:bg-accent/70');
  });
});
