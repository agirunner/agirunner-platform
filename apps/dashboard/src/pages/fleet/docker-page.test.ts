import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './docker-page.tsx'), 'utf8');
}

describe('docker page source', () => {
  it('keeps worker docker controls responsive and operator-readable', () => {
    const source = readSource();
    expect(source).toContain('CopyableIdBadge');
    expect(source).toContain('RelativeTimestamp');
    expect(source).toContain('View logs');
    expect(source).toContain('Prune exited containers');
    expect(source).toContain('Pull Docker image');
    expect(source).toContain('TabsList className="h-auto w-full flex-wrap"');
  });
});
