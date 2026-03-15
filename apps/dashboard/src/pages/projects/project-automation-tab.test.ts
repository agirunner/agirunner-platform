import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './project-automation-tab.tsx',
    './project-scheduled-triggers-card.tsx',
    './project-webhook-triggers-card.tsx',
    './project-git-webhook-signatures-card.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('project automation surface source', () => {
  it('uses progressive disclosure so the surface stays list-first instead of permanently form-heavy', () => {
    const source = readSource();
    expect(source).toContain('Add schedule');
    expect(source).toContain('Open signatures');
    expect(source).toContain('Hide signatures');
    expect(source).toContain('const [showEditor, setShowEditor] = useState(false)');
    expect(source).toContain("const [isExpanded, setExpanded] = useState(false)");
    expect(source).toContain(
      'Use this only when GitHub, Gitea, or GitLab should be allowed to deliver signed inbound repository events for this project.',
    );
    expect(source).not.toContain('Automation needs attention');
    expect(source).not.toContain('Automation live');
    expect(source).not.toContain('Refresh posture');
    expect(source).not.toContain('Automation status is partial');
    expect(source).not.toContain('Schedules, inbound hooks, and repository signatures in one scan-first surface.');
    expect(source).not.toContain('Verify provider, secret posture, and repository trust without leaving Automation.');
  });

  it('replaces the loud repository-secret validation copy with calmer inline guidance', () => {
    const source = readSource();
    expect(source).toContain('Use at least 8 characters before saving.');
    expect(source).not.toContain('Enter at least 8 characters so signature verification is usable.');
    expect(source).not.toContain('border-yellow-300 bg-yellow-50/70');
    expect(source).not.toContain('border-red-200 bg-red-50/70');
    expect(source).not.toContain('Save readiness');
  });
});
