import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './playbook-detail-page.tsx'), 'utf8');
}

describe('playbook detail page source', () => {
  it('builds a first-class structured playbook edit flow', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.getPlaybook');
    expect(source).toContain('dashboardApi.listPlaybooks');
    expect(source).toContain('dashboardApi.updatePlaybook');
    expect(source).toContain('max-w-7xl');
    expect(source).toContain('PlaybookAuthoringForm');
    expect(source).toContain('PlaybookControlCenterCard');
    expect(source).toContain('PlaybookRevisionHistoryCard');
    expect(source).toContain('buildPlaybookRestorePayload');
    expect(source).toContain('dashboardApi.archivePlaybook');
    expect(source).toContain('Archive Playbook');
    expect(source).toContain('max-h-[70vh] max-w-lg overflow-y-auto');
    expect(source).toContain('sticky bottom-4');
    expect(source).toContain('Save Playbook');
    expect(source).not.toContain('Raw JSON');
    expect(source.indexOf('<PlaybookAuthoringForm')).toBeLessThan(
      source.indexOf('<PlaybookControlCenterCard'),
    );
  });
});
