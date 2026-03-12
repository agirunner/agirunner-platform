import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './app.tsx'), 'utf8');
}

describe('app trigger routes source', () => {
  it('registers the trigger overview route and redirects the legacy path', () => {
    const source = readSource();
    expect(source).toContain('path="/config/triggers"');
    expect(source).toContain('path="/config/work-item-triggers"');
    expect(source).toContain('Navigate to="/config/triggers" replace');
  });
});
