import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(
    resolve(import.meta.dirname, './log-view-toggle.tsx'),
    'utf8',
  );
}

describe('log view toggle source', () => {
  it('uses readable active and inactive grouping controls', () => {
    const source = readSource();

    expect(source).toContain('border border-border/70 bg-card/80');
    expect(source).toContain('border-sky-600 bg-white text-sky-700');
    expect(source).toContain('dark:bg-slate-950');
    expect(source).toContain('text-foreground/80');
    expect(source).not.toContain("mode === optionMode && 'bg-muted'");
  });
});
