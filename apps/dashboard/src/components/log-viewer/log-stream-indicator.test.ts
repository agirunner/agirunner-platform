import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(
    resolve(import.meta.dirname, './log-stream-indicator.tsx'),
    'utf8',
  );
}

describe('log stream indicator source', () => {
  it('uses a readable live throughput chip instead of muted-on-muted styling', () => {
    const source = readSource();

    expect(source).not.toContain('rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground');
    expect(source).toContain('border-sky-600 bg-sky-600');
    expect(source).toContain('text-white');
    expect(source).toContain('dark:bg-sky-400');
  });
});
