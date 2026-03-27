import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('mission control workspace add-work dialog source', () => {
  it('keeps the add-work form scrollable within the viewport so the primary action remains reachable', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, './mission-control-workspace-add-work-dialog.tsx'),
      'utf8',
    );

    expect(source).toContain('max-h-[85vh]');
    expect(source).toContain('overflow-y-auto');
  });
});
