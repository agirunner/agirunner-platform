import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './workspace-automation-tab.tsx',
    './workspace-scheduled-triggers-card.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('workspace automation surface source', () => {
  it('keeps the workspace automation surface focused on schedules only', () => {
    const source = readSource();
    expect(source).toContain('Add schedule');
    expect(source).toContain('<ScheduledTriggersCard workspace={workspace} />');
    expect(source).not.toContain('Automation needs attention');
    expect(source).not.toContain('Automation live');
    expect(source).not.toContain('Refresh posture');
    expect(source).not.toContain('Automation status is partial');
    expect(source).not.toContain('repository trust');
  });

  it('removes the dormant workspace webhook component files entirely', () => {
    expect(
      existsSync(resolve(import.meta.dirname, './workspace-webhook-triggers-card.tsx')),
    ).toBe(false);
    expect(
      existsSync(resolve(import.meta.dirname, './workspace-git-webhook-signatures-card.tsx')),
    ).toBe(false);
  });
});
